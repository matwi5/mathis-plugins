"""Tests du contrôle des numéros de série des fichiers de décisions (scripts/check.py, duplicate_series) :
python3 -m unittest discover -s scripts/tests."""

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


if __name__ == "__main__":
    unittest.main()
