"""Tests du contrôle des numéros de série des fichiers de décisions (scripts/check.py, duplicate_series) :
python3 -m unittest discover -s scripts/tests."""

import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

PATH = "travail/essai/DECISIONS.md"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class DuplicateSeriesTest(unittest.TestCase):
    """Un titre « ## Série N » ajouté avec un numéro déjà pris est refusé ; les doublons déjà commités passent."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        # Les doublons 2 et 3 d'avant le contrôle, déjà commités.
        self.write("## Série 1 — a\n\n## Série 2 — b\n\n## Série 3 — c\n\n## Série 2 — d\n\n## Série 3 — e\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")
        # Les commandes git de check.py tournent dans REPO, valeur par défaut de `run` : le dépôt d'essai la remplace.
        self.saved = (check.REPO, check.run.__defaults__)
        check.REPO = self.repo
        check.run.__defaults__ = (self.repo, None)

    def tearDown(self):
        check.REPO, check.run.__defaults__ = self.saved
        self.dir.cleanup()

    def write(self, text):
        path = self.repo / PATH
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def stage(self, added):
        self.write((self.repo / PATH).read_text(encoding="utf-8") + added)
        git(self.repo, "add", PATH)

    def test_les_doublons_deja_commites_et_une_serie_neuve_passent(self):
        self.stage("\n## Série 4 — f\n")
        self.assertEqual(check.duplicate_series(PATH), [])

    def test_un_titre_ajoute_dont_le_numero_existe_est_refuse(self):
        self.stage("\n## Série 1 — g\n")
        problems = check.duplicate_series(PATH)
        self.assertEqual(len(problems), 1)
        self.assertIn(PATH, problems[0])
        self.assertIn("« ## Série 1 »", problems[0])
        self.assertIn("premier numéro libre : 4", problems[0])

    def test_un_doublon_ancien_repris_une_fois_de_plus_est_refuse(self):
        self.stage("\n## Série 3 — h\n")
        self.assertIn("« ## Série 3 »", "".join(check.duplicate_series(PATH)))

    def test_un_fichier_neuf_qui_double_un_numero_est_refuse(self):
        path = "travail/neuf/DECISIONS.md"
        target = self.repo / path
        target.parent.mkdir(parents=True)
        target.write_text("## Série 1 — a\n\n## Série 1 — b\n", encoding="utf-8")
        git(self.repo, "add", path)
        problems = check.duplicate_series(path)
        self.assertEqual(len(problems), 1)
        self.assertIn("premier numéro libre : 2", problems[0])

    def test_un_fichier_deplace_garde_ses_doublons_anciens(self):
        moved = "travail/autre/DECISIONS.md"
        (self.repo / "travail" / "autre").mkdir()
        git(self.repo, "mv", PATH, moved)
        self.assertEqual(check.staged_sources(), {moved: PATH})
        self.assertEqual(check.duplicate_series(moved, PATH), [])
        check.check_decisions([moved])
        # Le contrôle positif : un titre ajouté en double dans le fichier déplacé reste refusé.
        target = self.repo / moved
        target.write_text(target.read_text(encoding="utf-8") + "\n## Série 1 — j\n", encoding="utf-8")
        git(self.repo, "add", moved)
        with self.assertRaises(check.Failed):
            check.check_decisions([moved])

    def test_le_hook_refuse_un_commit_de_documentation_seule(self):
        self.stage("\n## Série 2 — i\n")
        with self.assertRaises(check.Failed):
            check.staged()


class DecisionsOffMainTest(unittest.TestCase):
    """Un fichier de décisions ne s'écrit que sur la branche principale (le clone principal, par
    `scripts/decision.py`) : dans un worktree, un commit qui le change est refusé, sauf une fusion ou
    une version indexée égale à celle de la branche principale."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name).resolve()
        self.main = base / "clone"
        self.main.mkdir()
        git(self.main, "init", "-q", "-b", "main")
        git(self.main, "config", "user.name", "essai")
        git(self.main, "config", "user.email", "essai@localhost")
        git(self.main, "config", "commit.gpgsign", "false")
        self.write(self.main, PATH, "## Série 1 — a\n")
        self.write(self.main, "travail/essai/issues/01-a.md", "# 01\n")
        git(self.main, "add", ".")
        git(self.main, "commit", "-q", "-m", "base")
        self.wt = base / "clone" / ".claude" / "worktrees" / "groupe-x"
        git(self.main, "worktree", "add", "-q", "-b", "worktree-groupe-x", str(self.wt))
        self.saved = (check.REPO, check.run.__defaults__)
        self.at(self.wt)

    def tearDown(self):
        check.REPO, check.run.__defaults__ = self.saved
        self.dir.cleanup()

    def at(self, repo):
        """Les commandes git de check.py tournent dans REPO, valeur par défaut de `run`."""
        check.REPO = repo
        check.run.__defaults__ = (repo, None)

    def forget_merge(self):
        """Ce que voit le hook pre-merge-commit d'une fusion propre : pas de MERGE_HEAD (git 2.54)."""
        Path(git(self.wt, "rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD")).unlink()

    def write(self, repo, path, text):
        target = repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    def add_series(self, repo, n):
        self.write(repo, PATH, (repo / PATH).read_text(encoding="utf-8") + f"\n## Série {n} — x\n")
        git(repo, "add", PATH)

    def test_dans_un_worktree_un_fichier_de_decisions_change_est_refuse(self):
        self.add_series(self.wt, 2)
        problems = check.decisions_off_main([PATH])
        self.assertEqual(len(problems), 1)
        self.assertIn(PATH, problems[0])
        self.assertIn("« worktree-groupe-x »", problems[0])
        # La commande vise le fichier du clone principal, pas celui du worktree.
        self.assertIn(f"python3 scripts/decision.py {self.main / PATH} <fichier de la série> -m <message>", problems[0])
        with self.assertRaises(check.Failed):
            check.staged()

    def test_le_clone_principal_est_celui_du_dossier_git_commun(self):
        # Une seule définition de main_clone : une seconde, ajoutée par ce contrôle, avait remplacé celle
        # qu'utilise ensure_types (et pouvait rendre None).
        self.assertEqual(check.main_clone(), self.main)
        source = (Path(__file__).resolve().parent.parent / "check.py").read_text(encoding="utf-8")
        defined = re.findall(r"^def (\w+)\(", source, re.M)
        self.assertEqual(sorted({n for n in defined if defined.count(n) > 1}), [])

    def test_un_nom_de_dossier_hors_forme_n_entre_jamais_dans_la_commande(self):
        path = "travail/x;touch pwned;$(id)/DECISIONS.md"
        self.write(self.wt, path, "## Série 1 — a\n")
        git(self.wt, "add", path)
        [problem] = check.decisions_off_main([path])
        # Cité pour le shell : la commande relue par un shell POSIX donne le chemin tel quel, en un argument.
        command = problem.split("principal : ", 1)[1]
        self.assertEqual(shlex.split(command)[2], (self.main / path).as_posix())
        self.assertIn("python3 scripts/decision.py '", problem)

    def test_un_fichier_neuf_dans_un_worktree_est_refuse(self):
        path = "travail/neuf/DECISIONS.md"
        self.write(self.wt, path, "## Série 1 — a\n")
        git(self.wt, "add", path)
        self.assertEqual(len(check.decisions_off_main([path])), 1)

    def test_une_tete_detachee_est_hors_de_la_branche_principale(self):
        git(self.wt, "switch", "-q", "--detach")
        self.add_series(self.wt, 2)
        self.assertEqual(len(check.decisions_off_main([PATH])), 1)

    def test_un_ticket_change_dans_un_worktree_passe(self):
        self.write(self.wt, "travail/essai/issues/01-a.md", "# 01\n\n**Status:** fait\n")
        git(self.wt, "add", "travail/essai/issues/01-a.md")
        self.assertEqual(check.decisions_off_main(["travail/essai/issues/01-a.md"]), [])
        check.staged()

    def test_sur_la_branche_principale_le_commit_passe(self):
        self.at(self.main)
        self.add_series(self.main, 2)
        self.assertEqual(check.decisions_off_main([PATH]), [])
        check.staged()

    def test_une_fusion_de_la_branche_principale_dans_le_worktree_passe(self):
        self.add_series(self.main, 2)
        git(self.main, "commit", "-q", "-m", "série 2")
        self.write(self.wt, "travail/essai/issues/01-a.md", "# 01\n\nbranche\n")
        git(self.wt, "commit", "-q", "-am", "ticket")
        # Le hook pre-merge-commit ne voit pas MERGE_HEAD (git 2.54) : la version indexée, égale à
        # celle de la branche principale, suffit. Une fusion arrêtée avant son commit a MERGE_HEAD.
        git(self.wt, "merge", "-q", "--no-ff", "--no-commit", "main")
        self.assertIn(PATH, git(self.wt, "diff", "--cached", "--name-only"))
        self.assertEqual(check.decisions_off_main([PATH]), [])
        self.forget_merge()
        self.assertEqual(check.decisions_off_main([PATH]), [])

    def test_une_fusion_qui_change_le_fichier_autrement_que_la_branche_principale_passe_avec_merge_head(self):
        self.add_series(self.main, 2)
        git(self.main, "commit", "-q", "-m", "série 2")
        git(self.wt, "merge", "-q", "--no-ff", "--no-commit", "main")
        self.add_series(self.wt, 3)
        # Pendant une fusion (MERGE_HEAD), le commit passe, comme le ticket le prévoit.
        self.assertEqual(check.decisions_off_main([PATH]), [])
        self.forget_merge()
        self.assertEqual(len(check.decisions_off_main([PATH])), 1)

    def test_le_hook_pre_merge_commit_dit_la_fusion(self):
        # Une fusion d'une version qui n'est pas celle de la branche principale locale (origin/main en
        # retard sur main, une autre branche de groupe), sans MERGE_HEAD : passe avec --merge.
        self.add_series(self.main, 2)
        git(self.main, "commit", "-q", "-m", "série 2")
        self.add_series(self.wt, 3)
        self.assertEqual(len(check.decisions_off_main([PATH])), 1)
        self.assertEqual(check.decisions_off_main([PATH], merging=True), [])
        hook = (Path(__file__).resolve().parent.parent / "hooks" / "pre-merge-commit").read_text(encoding="utf-8")
        self.assertIn('check.sh" --staged --merge', hook)


class DecisionsThroughHooksTest(unittest.TestCase):
    """Les vrais hooks du dépôt (pre-commit, pre-merge-commit) sur un dépôt jamais vu : un commit du
    fichier de décisions dans un worktree est refusé, une fusion propre qui l'amène passe, même quand la
    version amenée n'est pas celle de la branche principale locale (le hook ne voit pas MERGE_HEAD)."""

    SCRIPTS = ("check.sh", "check.py", "placeholders.py", "hooks/pre-commit", "hooks/pre-merge-commit")

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name).resolve()
        self.main = base / "clone"
        here = Path(__file__).resolve().parent.parent
        for rel in self.SCRIPTS:
            target = self.main / "scripts" / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(here / rel, target)
        git(self.main, "init", "-q", "-b", "main")
        git(self.main, "config", "user.name", "essai")
        git(self.main, "config", "user.email", "essai@localhost")
        git(self.main, "config", "commit.gpgsign", "false")
        self.series(self.main, 1)
        git(self.main, "add", ".")
        git(self.main, "commit", "-q", "-m", "base")
        git(self.main, "config", "core.hooksPath", "scripts/hooks")
        self.wt = self.main / ".claude" / "worktrees" / "groupe-x"
        git(self.main, "worktree", "add", "-q", "-b", "worktree-groupe-x", str(self.wt))

    def tearDown(self):
        self.dir.cleanup()

    def series(self, repo, n):
        path = repo / PATH
        path.parent.mkdir(parents=True, exist_ok=True)
        before = path.read_text(encoding="utf-8") if path.is_file() else ""
        path.write_text(before + f"## Série {n} — x\n\n", encoding="utf-8")

    def run_git(self, cwd, *args):
        return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True,
                              env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")})

    def test_un_commit_du_fichier_dans_le_worktree_est_refuse_par_le_hook(self):
        self.series(self.wt, 2)
        res = self.run_git(self.wt, "commit", "-q", "-am", "série dans le worktree")
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("python3 scripts/decision.py", res.stdout + res.stderr)

    def test_une_fusion_propre_qui_amene_une_version_ancienne_de_la_branche_principale_passe(self):
        # main reçoit la série 2, une autre branche part de là, puis main reçoit la série 3 : la fusion
        # de l'autre branche dans le worktree amène une version qui n'est plus celle de main.
        self.series(self.main, 2)
        self.assertEqual(self.run_git(self.main, "commit", "-q", "-am", "série 2").returncode, 0)
        self.assertEqual(self.run_git(self.main, "branch", "autre").returncode, 0)
        self.series(self.main, 3)
        self.assertEqual(self.run_git(self.main, "commit", "-q", "-am", "série 3").returncode, 0)
        res = self.run_git(self.wt, "merge", "-q", "--no-ff", "-m", "fusion", "autre")
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertIn("## Série 2", (self.wt / PATH).read_text(encoding="utf-8"))

if __name__ == "__main__":
    unittest.main()
