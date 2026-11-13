"""Tests de scripts/decision.py, l'ajout d'une série à un fichier de décisions partagé :
python3 -m unittest discover -s scripts/tests.

Chaque test tourne dans un dépôt git jetable, toutes les variables GIT_* retirées de l'environnement :
sous un hook git, elles viseraient l'index réel du clone."""

import importlib.util
import io
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parent.parent / "decision.py"
sys.path.insert(0, str(SCRIPT.parent))
import decision  # noqa: E402
PATH = "travail/essai/DECISIONS.md"
# Un chantier que le clone principal n'a pas encore : le script le crée.
NEW = "travail/nouveau/DECISIONS.md"
BASE = "# Décisions — essai\n\n## Série 1 — La demande (01/11/2026)\n\nTexte de la série 1.\n"
LOCK_HOLDER = ("import fcntl, os, sys, time\n"
               "f = open(sys.argv[1], 'a+')\n"
               "fcntl.flock(f, fcntl.LOCK_EX)\n"
               "f.seek(0); f.truncate(); f.write(str(os.getpid())); f.flush()\n"
               "print('tenu', flush=True)\n"
               "time.sleep(60)\n")


# Le verrou des tests (fcntl), SIGKILL, les liens symboliques et les droits des dossiers : POSIX seulement ;
# la branche Windows du verrou (msvcrt.locking) se teste sur tout poste par un faux `msvcrt` (FakeMsvcrt).
POSIX = os.name == "posix"


class FakeMsvcrt:
    """Un faux module `msvcrt` : note chaque appel de `locking` (position du fichier, mode, nombre d'octets) ;
    avec `refuse`, chaque prise non bloquante échoue, comme quand un autre processus tient l'octet."""
    LK_UNLCK, LK_NBLCK = 0, 2

    def __init__(self, refuse=False):
        self.calls, self.refuse = [], refuse

    def locking(self, fd, mode, nbytes):
        self.calls.append((os.lseek(fd, 0, os.SEEK_CUR), mode, nbytes))
        if self.refuse and mode == self.LK_NBLCK:
            raise OSError(36, "Resource deadlock avoided")


def windows_decision(fake):
    """Une copie de decision.py chargée comme sous Windows : `import fcntl` échoue, `msvcrt` est le faux.
    `sys.path` (où le module ajoute son dossier) et les deux entrées de `sys.modules` sont rendus tels quels."""
    spec = importlib.util.spec_from_file_location("decision_windows", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    saved_path = list(sys.path)
    saved = {name: sys.modules[name] for name in ("fcntl", "msvcrt") if name in sys.modules}
    sys.modules["fcntl"], sys.modules["msvcrt"] = None, fake
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path[:] = saved_path
        for name in ("fcntl", "msvcrt"):
            if name in saved:
                sys.modules[name] = saved[name]
            else:
                del sys.modules[name]
    return module


def clean_env(**extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(extra)
    return env


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True,
                          env=clean_env()).stdout.strip()


class DecisionTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name) / "depot"
        self.repo.mkdir()
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        self.hooks = Path(self.dir.name) / "hooks"
        self.hooks.mkdir()
        git(self.repo, "config", "core.hooksPath", str(self.hooks))
        self.file = self.repo / PATH
        self.file.parent.mkdir(parents=True)
        self.file.write_text(BASE, encoding="utf-8")
        (self.repo / "autre.txt").write_text("autre\n", encoding="utf-8")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")
        self.base_head = git(self.repo, "rev-parse", "HEAD")

    def tearDown(self):
        self.dir.cleanup()

    def series(self, name, title, body):
        path = Path(self.dir.name) / name
        path.write_text(f"{title}\n\n{body}\n", encoding="utf-8")
        return path

    def run_script(self, *args, wait="10", cwd=None):
        return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True,
                              encoding="utf-8", env=clean_env(DECISION_ATTENTE=wait), cwd=cwd or self.dir.name)

    def linked_worktree(self):
        """Un worktree lié du dépôt de test, sur sa propre branche, et son HEAD."""
        linked = Path(self.dir.name) / "lie"
        git(self.repo, "worktree", "add", "-q", "-b", "lie", str(linked))
        return linked, git(linked, "rev-parse", "HEAD")

    def hook(self, text):
        hook = self.hooks / "pre-commit"
        hook.write_text("#!/bin/sh\n" + text + "\n", encoding="utf-8")
        hook.chmod(0o755)

    def lock_path(self):
        return Path(git(self.repo, "rev-parse", "--path-format=absolute", "--git-common-dir")) / "decisions.lock"

    def committed(self):
        return git(self.repo, "show", f"HEAD:{PATH}") + "\n"

    def test_ajoute_la_serie_au_premier_numero_libre_et_ne_commite_qu_elle(self):
        out = self.run_script(self.file, self.series("s.md", "Réponse à Q1", "**Q1** : oui."), "-m", "docs: series 2")
        self.assertEqual(out.returncode, 0, out.stderr)
        sha = re.search(r"Série 2 : commit ([0-9a-f]{7,40})", out.stdout)
        self.assertIsNotNone(sha, out.stdout)
        self.assertEqual(git(self.repo, "rev-parse", "--short", "HEAD"), sha[1][:len(git(self.repo, "rev-parse", "--short", "HEAD"))])
        self.assertEqual(git(self.repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"), PATH)
        today = time.strftime("%d/%m/%Y")
        expected = BASE + f"\n## Série 2 — Réponse à Q1 ({today})\n\n**Q1** : oui.\n"
        self.assertEqual(self.committed(), expected)
        self.assertEqual(self.file.read_text(encoding="utf-8"), expected)
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")
        self.assertEqual(git(self.repo, "log", "-1", "--format=%s"), "docs: series 2")

    def test_l_ajout_non_commite_d_une_autre_discussion_reste_hors_du_commit(self):
        other = "\n## Série 2 — Celle d'une autre discussion (02/11/2026)\n\nPas encore commitée.\n"
        self.file.write_text(BASE + other, encoding="utf-8")
        message = Path(self.dir.name) / "message.txt"
        message.write_text("docs: my series\n", encoding="utf-8")
        out = self.run_script(self.file, self.series("s.md", "La mienne", "Mon corps."), "-F", message)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("Série 3 : commit", out.stdout)
        committed = self.committed()
        self.assertNotIn("autre discussion", committed)
        self.assertIn("## Série 3 — La mienne", committed)
        on_disk = self.file.read_text(encoding="utf-8")
        self.assertIn("autre discussion", on_disk)
        self.assertIn("## Série 3 — La mienne", on_disk)
        diff = git(self.repo, "diff", "--", PATH)
        self.assertIn("+## Série 2 — Celle d'une autre discussion", diff)
        self.assertNotIn("+## Série 3", diff)
        self.assertNotIn("+Mon corps.", diff)
        self.assertEqual(git(self.repo, "diff", "--cached", "--name-only"), "")

    def test_un_index_qui_porte_un_autre_fichier_est_refuse_sans_rien_ecrire(self):
        (self.repo / "autre.txt").write_text("changé\n", encoding="utf-8")
        git(self.repo, "add", "autre.txt")
        out = self.run_script(self.file, self.series("s.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 1)
        self.assertIn("autre.txt", out.stderr)
        self.assertEqual(self.file.read_text(encoding="utf-8"), BASE)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base_head)
        self.assertEqual(git(self.repo, "diff", "--cached", "--name-only"), "autre.txt")

    @unittest.skipUnless(POSIX, "verrou fcntl et SIGKILL : POSIX seulement")
    def test_un_verrou_orphelin_est_repris(self):
        holder = subprocess.Popen([sys.executable, "-c", LOCK_HOLDER, str(self.lock_path())], stdout=subprocess.PIPE,
                                  text=True)
        self.assertEqual(holder.stdout.readline().strip(), "tenu")
        holder.send_signal(signal.SIGKILL)
        holder.wait()
        holder.stdout.close()
        self.assertTrue(self.lock_path().read_text().strip().isdigit())
        out = self.run_script(self.file, self.series("s.md", "Titre", "Corps."), "-m", "x", wait="2")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("Série 2 : commit", out.stdout)

    @unittest.skipUnless(POSIX, "verrou fcntl : POSIX seulement")
    def test_un_verrou_vivant_au_dela_du_delai_fait_abandonner_sans_ecrire(self):
        holder = subprocess.Popen([sys.executable, "-c", LOCK_HOLDER, str(self.lock_path())], stdout=subprocess.PIPE,
                                  text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), "tenu")
            started = time.monotonic()
            out = self.run_script(self.file, self.series("s.md", "Titre", "Corps."), "-m", "x", wait="1")
            self.assertGreaterEqual(time.monotonic() - started, 1)
        finally:
            holder.kill()
            holder.wait()
            holder.stdout.close()
        self.assertEqual(out.returncode, 1)
        self.assertIn(f"processus {holder.pid}", out.stderr)
        self.assertEqual(self.file.read_text(encoding="utf-8"), BASE)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base_head)

    def test_le_delai_par_defaut_est_de_dix_secondes(self):
        out = subprocess.run([sys.executable, str(SCRIPT), "--aide"], capture_output=True, text=True, encoding="utf-8",
                             env=clean_env())
        self.assertIn("10 s", out.stdout + out.stderr)

    def test_un_commit_refuse_par_le_hook_rend_l_index_et_garde_la_serie_ecrite(self):
        self.hook("echo refusé par le hook >&2\nexit 1")
        out = self.run_script(self.file, self.series("s.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 3)
        self.assertIn("la série 2 reste écrite", out.stderr)
        self.assertIn("non commitée", out.stderr)
        self.assertIn("refusé par le hook", out.stderr)
        self.assertEqual(git(self.repo, "diff", "--cached", "--name-only"), "")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base_head)
        self.assertIn("## Série 2 — Titre", self.file.read_text(encoding="utf-8"))

    def test_le_hook_tourne_sur_l_index_prive_et_ce_qu_autrui_indexe_reste_hors_du_commit(self):
        # Pendant le hook, une autre discussion indexe un fichier dans l'index partagé : git commit l'aurait pris.
        seen = Path(self.dir.name) / "vu-par-le-hook.txt"
        self.hook(f'git diff --cached --name-only > "{seen}"\n'
                  f'cd "{self.repo}" && echo change >> autre.txt && env -u GIT_INDEX_FILE git add autre.txt')
        out = self.run_script(self.file, self.series("s.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(seen.read_text(encoding="utf-8").strip(), PATH)
        self.assertEqual(git(self.repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"), PATH)
        self.assertEqual(git(self.repo, "diff", "--cached", "--name-only"), "autre.txt")
        self.assertIn("## Série 2 — Titre", self.committed())

    def test_un_commit_d_autrui_pendant_le_hook_n_est_pas_efface(self):
        # Une autre discussion commite sa série 5 par l'index partagé pendant le hook : le commit du script part
        # alors du nouveau HEAD, et la série 5 reste dans HEAD.
        marker = Path(self.dir.name) / "deja-fait"
        self.hook(f'[ -e "{marker}" ] && exit 0\ntouch "{marker}"\nunset GIT_INDEX_FILE\ncd "{self.repo}"\n'
                  f'blob=$( (git show HEAD:{PATH}; printf "\\n## Série 5 — Autre (02/11/2026)\\n\\nAutre corps.\\n") '
                  f'| git hash-object -w --stdin)\n'
                  f'git update-index --cacheinfo 100644,$blob,{PATH} && git commit -q --no-verify -m autre')
        out = self.run_script(self.file, self.series("s.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("Série 2 : commit", out.stdout)
        committed = self.committed()
        self.assertIn("Autre corps.", committed)
        self.assertIn("## Série 2 — Titre", committed)
        self.assertEqual(git(self.repo, "log", "-1", "--format=%s", "HEAD^"), "autre")
        self.assertEqual(git(self.repo, "diff", "--cached", "--name-only"), "")
        # La série 5 n'a été écrite que dans l'index par l'autre discussion : l'arbre ne la porte pas, et seule elle
        # paraît dans le diff de l'arbre face à l'index.
        changed = [line for line in git(self.repo, "diff", "--", PATH).splitlines()
                   if line[:1] in "+-" and not line.startswith(("+++", "---"))]
        self.assertTrue(changed and all(line.startswith("-") for line in changed), changed)
        self.assertNotIn("Série 2", "\n".join(changed))

    def test_un_commit_d_autrui_qui_prend_la_serie_arrete_sans_doublon(self):
        # Un `git commit -- DECISIONS.md` d'une autre discussion, pendant le hook, prend la série déjà écrite.
        marker = Path(self.dir.name) / "deja-fait"
        self.hook(f'[ -e "{marker}" ] && exit 0\ntouch "{marker}"\nunset GIT_INDEX_FILE\ncd "{self.repo}"\n'
                  f'git commit -q --no-verify -m autre -- {PATH}')
        out = self.run_script(self.file, self.series("s.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 3, out.stderr)
        self.assertIn("porte déjà une série 2", out.stderr)
        self.assertEqual(len(re.findall(r"^## Série 2 ", self.committed(), re.M)), 1)
        self.assertEqual(git(self.repo, "log", "-1", "--format=%s"), "autre")

    def test_le_fichier_indexe_par_autrui_pendant_le_hook_arrete_sans_commiter(self):
        # Une autre discussion indexe son propre bloc du fichier pendant le hook (`git add -p`) : son blob n'a pas
        # la série, et un commit du script laisserait l'index prêt à la retirer ; il s'arrête, son index intact.
        self.hook(f'unset GIT_INDEX_FILE\ncd "{self.repo}"\n'
                  f'blob=$( (git show HEAD:{PATH}; printf "\\n## Série 7 — Autre (02/11/2026)\\n\\nAutre.\\n") '
                  f'| git hash-object -w --stdin)\ngit update-index --cacheinfo 100644,$blob,{PATH}\necho $blob > "{self.dir.name}/blob"')
        out = self.run_script(self.file, self.series("s.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 3, out.stderr)
        self.assertIn("a changé pendant le hook", out.stderr)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base_head)
        their = (Path(self.dir.name) / "blob").read_text().strip()
        self.assertEqual(git(self.repo, "ls-files", "-s", "--", PATH).split()[1], their)
        self.assertIn("## Série 2 — Titre", self.file.read_text(encoding="utf-8"))

    def test_index_lock_tenu_par_un_autre_git_est_attendu_puis_le_commit_et_l_index_vont_ensemble(self):
        # Un autre git tient index.lock quand le script remplace HEAD : il attend, puis installe HEAD et l'index
        # ensemble ; aucun commit d'autrui ne peut partir de HEAD avec l'ancien index entre les deux.
        lock = self.repo / ".git" / "index.lock"
        self.hook(f'touch "{lock}"\n( sleep 1; rm -f "{lock}" ) >/dev/null 2>&1 &')
        out = self.run_script(self.file, self.series("s.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertFalse(lock.exists())
        self.assertEqual(git(self.repo, "diff", "--cached", "--name-only"), "")
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")
        self.assertIn("## Série 2 — Titre", self.committed())

    @unittest.skipUnless(POSIX and os.geteuid() != 0, "droits des dossiers : POSIX, hors root")
    def test_un_echec_de_git_apres_l_ecriture_dit_que_la_serie_est_ecrite(self):
        objects = self.repo / ".git" / "objects"
        modes = {p: p.stat().st_mode for p in [objects, *objects.iterdir()] if p.is_dir()}
        for p in modes:
            p.chmod(0o555)
        try:
            out = self.run_script(self.file, self.series("s.md", "Titre", "Corps."), "-m", "x")
        finally:
            for p, mode in modes.items():
                p.chmod(mode)
        self.assertEqual(out.returncode, 3, out.stderr)
        self.assertIn("la série 2 reste écrite", out.stderr)
        self.assertNotIn("rien n'est écrit", out.stderr)
        self.assertIn("## Série 2 — Titre", self.file.read_text(encoding="utf-8"))
        self.assertEqual(git(self.repo, "diff", "--cached", "--name-only"), "")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base_head)

    def test_deux_lancements_simultanes_prennent_deux_numeros_qui_se_suivent(self):
        # Un pre-commit lent : sans verrou, le second lancement lirait le fichier pendant le commit du premier.
        self.hook("sleep 1")
        runs = [subprocess.Popen([sys.executable, str(SCRIPT), str(self.file), str(self.series(f"s{k}.md", f"Titre {k}",
                                                                                                f"Corps {k}.")),
                                  "-m", f"docs: run {k}"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                 encoding="utf-8", env=clean_env(DECISION_ATTENTE="20"), cwd=self.dir.name)
                for k in (1, 2)]
        outs = [r.communicate(timeout=60) for r in runs]
        for r, (stdout, stderr) in zip(runs, outs):
            self.assertEqual(r.returncode, 0, stderr)
        numbers = sorted(int(re.search(r"Série (\d+) : commit", stdout)[1]) for stdout, _ in outs)
        self.assertEqual(numbers, [2, 3])
        committed = self.committed()
        self.assertEqual(len(re.findall(r"^## Série \d+", committed, re.M)), 3)
        self.assertIn("Corps 1.", committed)
        self.assertIn("Corps 2.", committed)
        self.assertEqual(git(self.repo, "rev-list", "--count", f"{self.base_head}..HEAD"), "2")
        for sha in git(self.repo, "rev-list", f"{self.base_head}..HEAD").split():
            self.assertEqual(git(self.repo, "diff-tree", "--no-commit-id", "--name-only", "-r", sha), PATH)
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")

    def test_une_serie_mal_formee_ou_un_mauvais_fichier_sont_refuses(self):
        cases = [
            (self.file, self.series("a.md", "Titre", "## Série 9 — glissée dans le corps"), "titre de série"),
            (self.file, self.series("b.md", "", "Corps."), "titre"),
            (self.repo / "autre.txt", self.series("c.md", "Titre", "Corps."), "travail/<sujet>/DECISIONS.md"),
        ]
        for target, series, message in cases:
            out = self.run_script(target, series, "-m", "x")
            self.assertEqual(out.returncode, 1, (series.read_text(encoding="utf-8"), out.stdout))
            self.assertIn(message, out.stderr)
        untracked = self.repo / "travail" / "neuf" / "DECISIONS.md"
        untracked.parent.mkdir()
        untracked.write_text(BASE, encoding="utf-8")
        out = self.run_script(untracked, self.series("d.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 1)
        self.assertIn("suivi", out.stderr)
        if POSIX:
            link = self.repo / "travail" / "lien"
            link.mkdir()
            (link / "DECISIONS.md").symlink_to(self.file)
            out = self.run_script(link / "DECISIONS.md", self.series("e.md", "Titre", "Corps."), "-m", "x")
            self.assertEqual(out.returncode, 1)
            self.assertIn("lien symbolique", out.stderr)
        self.assertEqual(self.file.read_text(encoding="utf-8"), BASE)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base_head)

    def test_un_fichier_d_un_worktree_lie_est_refuse_et_renvoie_au_clone_principal(self):
        linked, linked_head = self.linked_worktree()
        out = self.run_script(linked / PATH, self.series("s.md", "Titre", "Corps."), "-m", "x", cwd=linked)
        self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
        self.assertIn("worktree lié", out.stderr)
        self.assertIn(f"sur sa branche main : relancer avec {self.repo.resolve() / PATH} ; rien n'est écrit", out.stderr)
        self.assertEqual((linked / PATH).read_text(encoding="utf-8"), BASE)
        self.assertEqual(git(linked, "rev-parse", "HEAD"), linked_head)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base_head)
        self.assertEqual(git(linked, "status", "--porcelain"), "")
        self.assertFalse(self.lock_path().exists())

    def test_le_chemin_donne_par_le_refus_ecrit_dans_le_clone_principal_depuis_le_worktree_lie(self):
        linked, linked_head = self.linked_worktree()
        refused = self.run_script(linked / PATH, self.series("s.md", "Titre", "Corps."), "-m", "x", cwd=linked)
        remedy = re.search(r"relancer avec (.+?) ; rien n'est écrit", refused.stderr)
        self.assertIsNotNone(remedy, refused.stderr)
        out = self.run_script(remedy[1], self.series("s.md", "Titre", "Corps."), "-m", "docs: series 2", cwd=linked)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("Série 2 : commit", out.stdout)
        self.assertIn("## Série 2 — Titre", self.committed())
        self.assertEqual(git(self.repo, "rev-parse", "--abbrev-ref", "HEAD"), "main")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD^"), self.base_head)
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")
        self.assertEqual((linked / PATH).read_text(encoding="utf-8"), BASE)
        self.assertEqual(git(linked, "rev-parse", "HEAD"), linked_head)
        self.assertEqual(git(linked, "status", "--porcelain"), "")

    def test_une_serie_du_clone_principal_puis_un_lancement_dans_le_worktree_lie_ne_doublent_aucun_numero(self):
        # Sans le refus, le worktree lié (sa branche partie avant la série 2) prenait aussi le numéro 2 : la fusion
        # des deux branches aurait porté deux séries 2.
        linked, linked_head = self.linked_worktree()
        first = self.run_script(self.file, self.series("a.md", "Celle du manager", "Corps a."), "-m", "x")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertIn("Série 2 : commit", first.stdout)
        second = self.run_script(linked / PATH, self.series("b.md", "Celle du worker", "Corps b."), "-m", "y",
                                 cwd=linked)
        self.assertEqual(second.returncode, 1, second.stdout)
        self.assertIn("worktree lié", second.stderr)
        self.assertNotIn("Série", second.stdout)
        self.assertEqual((linked / PATH).read_text(encoding="utf-8"), BASE)
        self.assertEqual(git(linked, "rev-parse", "HEAD"), linked_head)
        for text in (self.committed(), self.file.read_text(encoding="utf-8")):
            self.assertEqual(len(re.findall(r"^## Série 2 ", text, re.M)), 1)
            self.assertNotIn("Celle du worker", text)

    def test_un_worktree_qui_porte_une_serie_absente_du_clone_principal_ne_renvoie_pas_y_reprendre_son_numero(self):
        # Une série 2 commitée sur la branche du worktree (écrite à la main) : la relance dans le clone principal
        # reprendrait le numéro 2, et la fusion porterait deux séries 2.
        linked, linked_head = self.linked_worktree()
        (linked / PATH).write_text(BASE + "\n## Série 2 — Celle du worktree (02/11/2026)\n\nCorps.\n", encoding="utf-8")
        git(linked, "commit", "-q", "-am", "serie 2 du worktree")
        out = self.run_script(linked / PATH, self.series("s.md", "Titre", "Corps."), "-m", "x", cwd=linked)
        self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
        self.assertIn("des séries que le clone principal n'a pas (2) : les amener d'abord", out.stderr)
        self.assertNotIn("relancer avec", out.stderr)
        self.assertEqual(self.file.read_text(encoding="utf-8"), BASE)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base_head)
        self.assertIn("Celle du worktree", (linked / PATH).read_text(encoding="utf-8"))
        self.assertNotEqual(git(linked, "rev-parse", "HEAD"), linked_head)
        self.assertEqual(git(linked, "log", "-1", "--format=%s"), "serie 2 du worktree")
        self.assertEqual(git(linked, "status", "--porcelain"), "")
        self.assertFalse(self.lock_path().exists())

    def test_un_chantier_absent_du_clone_principal_et_commite_dans_le_worktree_est_refuse_sans_rien_creer(self):
        # Le fichier commité sur la branche du worktree : le créer aussi dans le clone principal en ferait deux.
        linked, _ = self.linked_worktree()
        neuf = linked / NEW
        neuf.parent.mkdir()
        neuf.write_text(BASE, encoding="utf-8")
        git(linked, "add", NEW)
        git(linked, "commit", "-q", "-m", "chantier neuf")
        out = self.run_script(neuf, self.series("s.md", "Titre", "Corps."), "-m", "x", cwd=linked)
        self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
        self.assertIn("il existe déjà ailleurs dans le dépôt", out.stderr)
        self.assertIn("l'amener d'abord dans le clone principal", out.stderr)
        self.assertNotIn("relancer avec", out.stderr)
        self.assertEqual(neuf.read_text(encoding="utf-8"), BASE)
        self.assertFalse((self.repo / NEW).parent.exists())
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base_head)
        self.assertFalse(self.lock_path().exists())

    def new_text(self, title="Titre", body="Corps."):
        return (f"# Décisions — nouveau\n\n## Série 1 — {title} ({time.strftime('%d/%m/%Y')})\n\n{body}\n")

    def assert_nothing_created(self, head=None):
        self.assertFalse(os.path.lexists(self.repo / NEW))
        self.assertFalse((self.repo / NEW).parent.exists())
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), head or self.base_head)

    def test_un_fichier_absent_du_clone_principal_y_est_cree_avec_la_serie_1_et_seul_commite(self):
        out = self.run_script(self.repo / NEW, self.series("s.md", "Titre", "Corps."), "-m", "docs: new")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout.strip(), f"Série 1 : commit {git(self.repo, 'rev-parse', '--short', 'HEAD')} "
                                             f"(fichier créé : {self.repo.resolve() / NEW})")
        self.assertEqual((self.repo / NEW).read_text(encoding="utf-8"), self.new_text())
        self.assertEqual(git(self.repo, "show", f"HEAD:{NEW}") + "\n", self.new_text())
        self.assertEqual(git(self.repo, "diff-tree", "--no-commit-id", "--name-status", "-r", "HEAD"), f"A\t{NEW}")
        self.assertEqual(git(self.repo, "ls-tree", "HEAD", NEW).split()[0], "100644")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD^"), self.base_head)
        self.assertEqual(git(self.repo, "log", "-1", "--format=%s"), "docs: new")
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")
        if POSIX:
            mask = os.umask(0)
            os.umask(mask)
            self.assertEqual((self.repo / NEW).stat().st_mode & 0o777, 0o666 & ~mask)
        # Le fichier créé reçoit ensuite les séries suivantes comme tout autre.
        second = self.run_script(self.repo / NEW, self.series("t.md", "Suite", "Corps 2."), "-m", "docs: 2")
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(second.stdout.strip(), f"Série 2 : commit {git(self.repo, 'rev-parse', '--short', 'HEAD')}")

    def test_depuis_un_worktree_lie_le_fichier_absent_est_cree_dans_le_clone_principal_jamais_dans_le_worktree(self):
        linked, linked_head = self.linked_worktree()
        out = self.run_script(linked / NEW, self.series("s.md", "Titre", "Corps."), "-m", "docs: new", cwd=linked)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn(f"(fichier créé : {self.repo.resolve() / NEW})", out.stdout)
        self.assertEqual((self.repo / NEW).read_text(encoding="utf-8"), self.new_text())
        self.assertEqual(git(self.repo, "show", f"HEAD:{NEW}") + "\n", self.new_text())
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")
        self.assertFalse((linked / NEW).parent.exists())
        self.assertEqual(git(linked, "rev-parse", "HEAD"), linked_head)
        self.assertEqual(git(linked, "status", "--porcelain"), "")

    def test_un_worktree_qui_porte_le_fichier_absent_du_clone_principal_fait_refuser_sans_rien_ecrire(self):
        # Dans son arbre (non suivi), dans son index seul, ou commité sur sa branche ; lancé depuis ce worktree ou
        # depuis le clone principal : un fichier de décisions n'existe qu'à un seul endroit.
        cases = {
            "son arbre": lambda wt: (wt / NEW).write_text(BASE, encoding="utf-8"),
            "son index": lambda wt: ((wt / NEW).write_text(BASE, encoding="utf-8"), git(wt, "add", NEW),
                                     (wt / NEW).unlink()),
            "son HEAD": lambda wt: ((wt / NEW).write_text(BASE, encoding="utf-8"), git(wt, "add", NEW),
                                    git(wt, "commit", "-q", "-m", "neuf"), git(wt, "rm", "-q", NEW)),
        }
        for k, (where, carry) in enumerate(cases.items()):
            linked = Path(self.dir.name) / f"porte-{k}"
            git(self.repo, "worktree", "add", "-q", "-b", f"porte-{k}", str(linked))
            (linked / NEW).parent.mkdir()
            carry(linked)
            for caller, cwd in ((linked / NEW, linked), (self.repo / NEW, self.repo)):
                with self.subTest(where=where, caller=str(caller)):
                    out = self.run_script(caller, self.series("s.md", "Titre", "Corps."), "-m", "x", cwd=cwd)
                    self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
                    held = f"la branche porte-{k} ({NEW})" if where == "son HEAD" else f"{linked.resolve()} ({where})"
                    self.assertIn(held, out.stderr)
                    self.assertIn("l'amener d'abord dans le clone principal", out.stderr)
                    self.assertIn("rien n'est écrit", out.stderr)
                    self.assert_nothing_created()
                    self.assertFalse(self.lock_path().exists())
            git(self.repo, "worktree", "remove", "--force", str(linked))

    def test_deux_lancements_simultanes_sur_un_fichier_absent_le_creent_une_fois_puis_ajoutent_la_serie_2(self):
        self.hook("sleep 1")
        runs = [subprocess.Popen([sys.executable, str(SCRIPT), str(self.repo / NEW),
                                  str(self.series(f"s{k}.md", f"Titre {k}", f"Corps {k}.")), "-m", f"docs: run {k}"],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                 env=clean_env(DECISION_ATTENTE="20"), cwd=self.dir.name)
                for k in (1, 2)]
        outs = [r.communicate(timeout=60) for r in runs]
        for r, (stdout, stderr) in zip(runs, outs):
            self.assertEqual(r.returncode, 0, stderr)
        numbers = sorted(int(re.search(r"Série (\d+) : commit", stdout)[1]) for stdout, _ in outs)
        self.assertEqual(numbers, [1, 2])
        self.assertEqual(sum("fichier créé" in stdout for stdout, _ in outs), 1)
        committed = git(self.repo, "show", f"HEAD:{NEW}") + "\n"
        self.assertEqual(committed, (self.repo / NEW).read_text(encoding="utf-8"))
        self.assertEqual(len(re.findall(r"^# Décisions — nouveau$", committed, re.M)), 1)
        self.assertEqual(re.findall(r"^## Série (\d+)", committed, re.M), ["1", "2"])
        self.assertIn("Corps 1.", committed)
        self.assertIn("Corps 2.", committed)
        shas = git(self.repo, "rev-list", f"{self.base_head}..HEAD").split()
        self.assertEqual(len(shas), 2)
        for sha in shas:
            self.assertEqual(git(self.repo, "diff-tree", "--no-commit-id", "--name-only", "-r", sha), NEW)
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")

    def test_les_refus_valent_aussi_pour_un_fichier_absent_et_ne_creent_rien(self):
        series = self.series("s.md", "Titre", "Corps.")
        # Un chemin hors de `DECISIONS_FILE`.
        for wrong in ("travail/nouveau/AUTRE.md", "travail/nouveau/sous/DECISIONS.md", "ailleurs/nouveau/DECISIONS.md"):
            out = self.run_script(self.repo / wrong, series, "-m", "x")
            self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
            self.assertIn("travail/<sujet>/DECISIONS.md", out.stderr)
            self.assertFalse((self.repo / wrong).parent.exists())
        # Un sujet hors de la liste blanche, d'après le corpus hostile (règle « Un garde de forme passe le corpus
        # hostile commun ») : contrôles C0 et C1, séparateurs de ligne, espaces, accents, sosies, signe Kelvin,
        # chiffres pleine chasse, invisibles, apostrophe typographique, chaîne trop longue. Les caractères
        # invisibles s'écrivent par leur point de code (`chr`), jamais bruts dans la source.
        hostile = ["a\n## Série 9", "a\tb", "a" + chr(0x85) + "b", "a" + chr(0x2028) + "b", "deux mots", "été",
                   chr(0x212A) + "elvin", "nouv" + chr(0x435) + "au", chr(0xFF11) + chr(0xFF12), "a" + chr(0x200B) + "b",
                   chr(0xFEFF) + "a", "l" + chr(0x2019) + "essai", "-tiret", "x" * 101, "x.", "a\x0bb", "a\x0cb",
                   "a\rb", "a\x7fb", "a" + chr(0x2029) + "b", chr(0xFB01) + "n", "a" + chr(0xA0) + "b",
                   chr(0x202E) + "a", chr(0xFF21), "l" + chr(0x2018) + "a", "l" + chr(0x2BC) + "a", "$(x)", "a;b",
                   "a*b"]
        for subject in hostile:
            with self.subTest(subject=subject):
                out = self.run_script(self.repo / "travail" / subject / "DECISIONS.md", series, "-m", "x")
                self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
                self.assertIn("n'est pas créé", out.stderr)
                self.assertFalse((self.repo / "travail" / subject).exists())
        # Un index non vide.
        (self.repo / "autre.txt").write_text("changé\n", encoding="utf-8")
        git(self.repo, "add", "autre.txt")
        out = self.run_script(self.repo / NEW, series, "-m", "x")
        self.assertEqual(out.returncode, 1)
        self.assertIn("l'index porte déjà", out.stderr)
        self.assert_nothing_created()
        git(self.repo, "reset", "-q")
        git(self.repo, "checkout", "-q", "--", "autre.txt")
        # Une fusion en cours.
        merge_head = Path(git(self.repo, "rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"))
        merge_head.write_text(self.base_head + "\n", encoding="utf-8")
        out = self.run_script(self.repo / NEW, series, "-m", "x")
        merge_head.unlink()
        self.assertEqual(out.returncode, 1)
        self.assertIn("MERGE_HEAD", out.stderr)
        self.assert_nothing_created()
        # Un fichier suivi dans HEAD mais retiré de l'arbre : jamais recréé par-dessus ses séries.
        self.file.unlink()
        out = self.run_script(self.file, series, "-m", "x")
        self.assertEqual(out.returncode, 1)
        self.assertIn("retiré de l'arbre", out.stderr)
        self.assertFalse(self.file.exists())
        git(self.repo, "checkout", "-q", "--", PATH)
        if POSIX:
            # Un dossier de chantier qui est un lien symbolique vers un autre chantier.
            (self.repo / "travail" / "nouveau").symlink_to(self.repo / "travail" / "vise")
            (self.repo / "travail" / "vise").mkdir()
            out = self.run_script(self.repo / NEW, series, "-m", "x")
            self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
            self.assertIn("lien symbolique", out.stderr)
            self.assertFalse((self.repo / "travail" / "vise" / "DECISIONS.md").exists())
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base_head)

    def test_une_creation_refusee_par_le_hook_est_defaite_sans_fichier_ni_dossier_laisse(self):
        self.hook("echo refusé par le hook >&2\nexit 1")
        out = self.run_script(self.repo / NEW, self.series("s.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 4, out.stdout + out.stderr)
        self.assertIn("refusé par le hook", out.stderr)
        self.assertIn(f"création défaite : {NEW} n'est pas laissé", out.stderr)
        self.assertNotIn("Série", out.stdout)
        self.assert_nothing_created()
        self.assertEqual(git(self.repo, "status", "--porcelain", "--ignored"), "")

    def test_une_creation_dont_le_fichier_a_change_pendant_le_hook_le_laisse_et_le_dit(self):
        # Une autre discussion écrit dans le fichier créé pendant le hook : il ne porte plus les seuls octets de ce
        # lancement, et il n'est pas retiré.
        self.hook(f'echo "Ligne d\'autrui." >> "{self.repo / NEW}"\nexit 1')
        out = self.run_script(self.repo / NEW, self.series("s.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 3, out.stdout + out.stderr)
        self.assertIn("porte autre chose", out.stderr)
        self.assertEqual((self.repo / NEW).read_text(encoding="utf-8"), self.new_text() + "Ligne d'autrui.\n")
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base_head)
        self.assertEqual([p.name for p in (self.repo / NEW).parent.iterdir()], ["DECISIONS.md"])

    @unittest.skipUnless(POSIX and os.geteuid() != 0, "droits des dossiers : POSIX, hors root")
    def test_une_creation_qui_ne_peut_pas_ecrire_est_defaite_sans_dossier_laisse(self):
        # `travail/` en lecture seule : le dossier du chantier ne se crée pas. Puis le dossier se crée mais le fichier
        # ne s'y écrit pas (disque plein) : le dossier créé est retiré.
        travail = self.repo / "travail"
        travail.chmod(0o555)
        try:
            out = self.run_script(self.repo / "travail" / "nouveau" / "DECISIONS.md",
                                  self.series("s.md", "Titre", "Corps."), "-m", "x")
        finally:
            travail.chmod(0o755)
        self.assertEqual(out.returncode, 4, out.stdout + out.stderr)
        self.assertIn("écriture impossible", out.stderr)
        self.assert_nothing_created()
        with mock.patch.object(decision, "link_new", side_effect=OSError(28, "No space left on device")):
            with self.assertRaises(decision.DecisionError) as raised:
                decision.add_series(self.repo / NEW, self.series("t.md", "Titre", "Corps."), ["-m", "x"], "x", 1)
        self.assertEqual(raised.exception.code, 4)
        self.assertIn("création défaite", str(raised.exception))
        self.assert_nothing_created()

    def test_une_branche_sans_worktree_qui_porte_le_fichier_fait_refuser_la_creation(self):
        # Le cas d'origine : le fichier commité sur la branche d'un groupe dont le worktree est fermé, branche gardée.
        linked, _ = self.linked_worktree()
        (linked / NEW).parent.mkdir()
        (linked / NEW).write_text(BASE, encoding="utf-8")
        git(linked, "add", NEW)
        git(linked, "commit", "-q", "-m", "chantier du groupe")
        git(self.repo, "worktree", "remove", str(linked))
        out = self.run_script(self.repo / NEW, self.series("s.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
        self.assertIn("la branche lie", out.stderr)
        self.assertIn("l'amener d'abord dans le clone principal", out.stderr)
        self.assert_nothing_created()

    def test_un_chantier_du_meme_nom_a_la_casse_pres_fait_refuser_la_creation(self):
        (self.repo / "travail" / "Nouveau").mkdir()
        (self.repo / "travail" / "Nouveau" / "spec.md").write_text("spec\n", encoding="utf-8")
        git(self.repo, "add", "travail/Nouveau/spec.md")
        git(self.repo, "commit", "-q", "-m", "spec")
        head = git(self.repo, "rev-parse", "HEAD")
        out = self.run_script(self.repo / NEW, self.series("s.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
        self.assertIn("à la casse près existe déjà (travail/Nouveau)", out.stderr)
        self.assertFalse((self.repo / "travail" / "Nouveau" / "DECISIONS.md").exists())
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), head)

    @unittest.skipUnless(POSIX, "liens symboliques : POSIX")
    def test_un_lien_vers_le_chantier_d_un_autre_depot_ne_cree_rien_dans_l_autre_depot(self):
        other = Path(self.dir.name) / "autre-depot"
        other.mkdir()
        git(other, "init", "-q", "-b", "main")
        git(other, "config", "user.name", "essai")
        git(other, "config", "user.email", "essai@localhost")
        (other / "README").write_text("x\n", encoding="utf-8")
        git(other, "add", "README")
        git(other, "commit", "-q", "-m", "base")
        (other / "travail" / "nouveau").mkdir(parents=True)
        (self.repo / "travail" / "nouveau").symlink_to(other / "travail" / "nouveau")
        out = self.run_script(self.repo / NEW, self.series("s.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
        self.assertIn("lien symbolique", out.stderr)
        self.assertFalse((other / "travail" / "nouveau" / "DECISIONS.md").exists())
        self.assertEqual(git(other, "rev-list", "--count", "HEAD"), "1")

    def test_head_qui_avance_sans_le_fichier_pendant_une_creation_fait_recommencer_sur_le_nouveau(self):
        marker = Path(self.dir.name) / "deja-fait"
        self.hook(f'[ -e "{marker}" ] && exit 0\ntouch "{marker}"\nunset GIT_INDEX_FILE\ncd "{self.repo}"\n'
                  f'echo change >> autre.txt && git commit -q --no-verify -m autre -- autre.txt')
        out = self.run_script(self.repo / NEW, self.series("s.md", "Titre", "Corps."), "-m", "docs: new")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("fichier créé", out.stdout)
        self.assertEqual(git(self.repo, "log", "-1", "--format=%s", "HEAD^"), "autre")
        self.assertEqual(git(self.repo, "show", f"HEAD:{NEW}") + "\n", self.new_text())
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")

    def test_un_commit_d_autrui_qui_prend_la_serie_1_creee_dit_qu_elle_est_commitee_et_la_laisse(self):
        # Une autre discussion commite `travail/` par l'index partagé pendant le hook, et prend le fichier non suivi.
        marker = Path(self.dir.name) / "deja-fait"
        self.hook(f'[ -e "{marker}" ] && exit 0\ntouch "{marker}"\nunset GIT_INDEX_FILE\ncd "{self.repo}"\n'
                  f'git add travail && git commit -q --no-verify -m prise')
        out = self.run_script(self.repo / NEW, self.series("s.md", "Titre", "Corps."), "-m", "docs: new")
        self.assertEqual(out.returncode, 3, out.stdout + out.stderr)
        self.assertIn("avec la série 1 de ce lancement, prise par le commit d'une autre discussion", out.stderr)
        self.assertIn("ne pas relancer", out.stderr)
        self.assertNotIn("non commitée", out.stderr)
        self.assertNotIn("à vérifier avant toute relance", out.stderr)
        self.assertEqual(out.stdout.strip(), f"Série 1 : commit {git(self.repo, 'rev-parse', 'HEAD')[:12]} (reste à "
                                             f"vérifier : voir le message d'échec)")
        self.assertEqual(git(self.repo, "log", "-1", "--format=%s"), "prise")
        self.assertEqual((self.repo / NEW).read_text(encoding="utf-8"), self.new_text())
        self.assertEqual(git(self.repo, "show", f"HEAD:{NEW}") + "\n", self.new_text())

    def test_une_interruption_ou_une_erreur_inattendue_pendant_le_commit_defait_la_creation_et_le_dit(self):
        for raised in (KeyboardInterrupt, SystemExit(143), TypeError("inattendue")):
            with self.subTest(raised=repr(raised)):
                with mock.patch.object(decision, "commit_series", side_effect=raised):
                    with self.assertRaises(decision.DecisionError) as caught:
                        decision.add_series(self.repo / NEW, self.series("s.md", "Titre", "Corps."), ["-m", "x"], "x", 1)
                self.assertEqual(caught.exception.code, 4)
                self.assertIn("création défaite", str(caught.exception))
                self.assert_nothing_created()
                self.assertEqual(git(self.repo, "status", "--porcelain", "--ignored"), "")

    def test_une_interruption_pendant_le_commit_d_un_ajout_dit_que_la_serie_est_ecrite(self):
        # Sans ce code 3, une relance ajouterait la série une seconde fois.
        for raised in (KeyboardInterrupt, SystemExit(143)):
            with self.subTest(raised=repr(raised)):
                self.file.write_text(BASE, encoding="utf-8")
                with mock.patch.object(decision, "commit_series", side_effect=raised):
                    with self.assertRaises(decision.DecisionError) as caught:
                        decision.add_series(self.file, self.series("s.md", "Titre", "Corps."), ["-m", "x"], "x", 1)
                self.assertEqual(caught.exception.code, 3)
                self.assertIn("interrompu", str(caught.exception))
                self.assertIn("la série 2 reste écrite", str(caught.exception))
                self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base_head)
        self.file.write_text(BASE, encoding="utf-8")

    def test_un_worktree_dont_le_dossier_a_perdu_son_point_git_fait_refuser_la_creation(self):
        # Sans son fichier `.git`, git remonterait vers un autre dépôt : dans le doute, rien n'est créé.
        linked, _ = self.linked_worktree()
        (linked / ".git").unlink()
        out = self.run_script(self.repo / NEW, self.series("s.md", "Titre", "Corps."), "-m", "x")
        self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
        self.assertIn("son index, illisible", out.stderr)
        self.assert_nothing_created()

    @unittest.skipUnless(POSIX, "signaux : POSIX")
    def test_un_sigterm_pendant_le_hook_d_une_creation_la_defait(self):
        started = Path(self.dir.name) / "hook-lance"
        self.hook(f'touch "{started}"\nsleep 30')
        run = subprocess.Popen([sys.executable, str(SCRIPT), str(self.repo / NEW), str(self.series("s.md", "T", "C.")),
                                "-m", "x"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
                               env=clean_env(DECISION_ATTENTE="10"), cwd=self.dir.name)
        deadline = time.monotonic() + 30
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        run.send_signal(signal.SIGTERM)
        _, stderr = run.communicate(timeout=60)
        self.assertEqual(run.returncode, 4, stderr)
        self.assertIn("interrompu (SystemExit)", stderr)
        self.assert_nothing_created()

    def test_une_branche_distante_ou_une_branche_a_la_casse_pres_fait_refuser_la_creation(self):
        # Une branche poussée d'un autre poste et relevée sans fusion (`refs/remotes`), puis une branche locale
        # sans worktree qui porte le même fichier à la casse près.
        for ref, path in (("refs/remotes/origin/autre-poste", NEW), ("refs/heads/casse", "travail/Nouveau/DECISIONS.md")):
            with self.subTest(ref=ref):
                linked = Path(self.dir.name) / "porteur"
                git(self.repo, "worktree", "add", "-q", "--detach", str(linked))
                (linked / path).parent.mkdir(parents=True)
                (linked / path).write_text(BASE, encoding="utf-8")
                git(linked, "add", path)
                git(linked, "commit", "-q", "-m", "ailleurs")
                git(self.repo, "update-ref", ref, git(linked, "rev-parse", "HEAD"))
                git(self.repo, "worktree", "remove", "--force", str(linked))
                out = self.run_script(self.repo / NEW, self.series("s.md", "Titre", "Corps."), "-m", "x")
                self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
                self.assertIn(f"({path})", out.stderr)
                self.assertIn("il existe déjà ailleurs dans le dépôt", out.stderr)
                self.assert_nothing_created()
                git(self.repo, "update-ref", "-d", ref)

    @unittest.skipUnless(POSIX, "liens symboliques : POSIX")
    def test_un_raccourci_vers_la_racine_du_depot_cree_dans_le_depot(self):
        shortcut = Path(self.dir.name) / "raccourci"
        shortcut.symlink_to(self.repo)
        out = self.run_script(shortcut / NEW, self.series("s.md", "Titre", "Corps."), "-m", "docs: new")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(git(self.repo, "show", f"HEAD:{NEW}") + "\n", self.new_text())

    def test_avec_un_dossier_git_separe_le_refus_ne_donne_aucune_relance(self):
        # Le parent du dossier git commun (`sep.git`) n'est alors pas la racine de travail : le clone principal est
        # introuvable, et une relance vers une racine non vérifiée sauterait le contrôle des séries du worktree.
        gitdir, main = Path(self.dir.name) / "sep.git", Path(self.dir.name) / "sep"
        git(self.dir.name, "init", "-q", "-b", "main", "--separate-git-dir", str(gitdir), str(main))
        git(main, "config", "user.name", "essai")
        git(main, "config", "user.email", "essai@localhost")
        git(main, "config", "commit.gpgsign", "false")
        (main / PATH).parent.mkdir(parents=True)
        (main / PATH).write_text(BASE, encoding="utf-8")
        git(main, "add", ".")
        git(main, "commit", "-q", "--no-verify", "-m", "base")
        linked = Path(self.dir.name) / "sep-lie"
        git(main, "worktree", "add", "-q", "-b", "lie", str(linked))
        out = self.run_script(linked / PATH, self.series("s.md", "Titre", "Corps."), "-m", "x", cwd=linked)
        self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
        self.assertIn("worktree lié", out.stderr)
        self.assertIn("racine du clone principal introuvable", out.stderr)
        self.assertNotIn("relancer", out.stderr)
        self.assertNotIn(str(main.resolve() / PATH), out.stderr)
        self.assertNotIn(str(gitdir.resolve() / PATH), out.stderr)
        self.assertEqual((linked / PATH).read_text(encoding="utf-8"), BASE)

    def test_sous_windows_le_verrou_se_prend_et_se_relache_a_l_octet_lock_offset(self):
        fake = FakeMsvcrt()
        module = windows_decision(fake)
        self.assertIsNone(module.fcntl)
        handle = module.take_lock(self.repo, 1)
        try:
            self.assertEqual(fake.calls, [(4096, fake.LK_NBLCK, 1)])
            self.assertEqual(self.lock_path().read_text(encoding="utf-8"), f"{os.getpid()}\n")
        finally:
            module.release(handle)
        self.assertEqual(fake.calls[1:], [(4096, fake.LK_UNLCK, 1)])
        self.assertTrue(handle.closed)

    def test_sous_windows_un_verrou_tenu_fait_abandonner_apres_le_delai_sans_rien_ecrire(self):
        self.lock_path().write_text("4242\n", encoding="utf-8")
        fake = FakeMsvcrt(refuse=True)
        module = windows_decision(fake)
        started = time.monotonic()
        with self.assertRaises(module.DecisionError) as raised:
            module.take_lock(self.repo, 0.3)
        self.assertGreaterEqual(time.monotonic() - started, 0.3)
        self.assertIn("processus 4242", str(raised.exception))
        self.assertIn("rien n'est écrit", str(raised.exception))
        self.assertEqual(raised.exception.code, 1)
        self.assertGreater(len(fake.calls), 1)
        self.assertTrue(all(call == (4096, fake.LK_NBLCK, 1) for call in fake.calls))
        self.assertEqual(self.lock_path().read_text(encoding="utf-8"), "4242\n")

    def test_un_git_plus_ancien_que_2_36_ou_sans_version_lisible_est_refuse_sans_rien_ecrire(self):
        real_git = decision.git
        for answer in ("git version 2.35.1", "git version inconnue"):
            def fake_git(cwd, *args, **kwargs):
                if args == ("version",):
                    return subprocess.CompletedProcess(["git", *args], 0, f"{answer}\n".encode(), b"")
                return real_git(cwd, *args, **kwargs)
            err = io.StringIO()
            with mock.patch.object(decision, "git", fake_git), redirect_stderr(err):
                code = decision.main([str(self.file), str(self.series("s.md", "Titre", "Corps.")), "-m", "x"])
            self.assertEqual(code, 1, (answer, err.getvalue()))
            self.assertIn("plus ancien que 2.36", err.getvalue())
            self.assertEqual(self.file.read_text(encoding="utf-8"), BASE)
            self.assertEqual(git(self.repo, "rev-parse", "HEAD"), self.base_head)
            self.assertEqual(git(self.repo, "status", "--porcelain"), "")

    def test_sans_message_la_commande_est_refusee(self):
        out = self.run_script(self.file, self.series("s.md", "Titre", "Corps."))
        self.assertEqual(out.returncode, 2)
        self.assertIn("-m <message>", out.stderr)
        self.assertEqual(self.file.read_text(encoding="utf-8"), BASE)


if __name__ == "__main__":
    unittest.main()
