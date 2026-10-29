"""Tests du contrôle de version pendant une fusion (scripts/check.py, version_advance) :
python3 -m unittest discover -s scripts/tests."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class VersionDuringMergeTest(unittest.TestCase):
    """La fusion de `main` dans une branche apporte la version que `main` a publiée : ce n'est pas un
    numéro posé par la branche, et le hook ne doit pas la refuser."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        self.plugin = self.repo / "plugins" / "essai"
        (self.plugin / ".claude-plugin").mkdir(parents=True)
        self.version("0.1.0")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")
        git(self.repo, "checkout", "-q", "-b", "travail")
        (self.repo / "autre.txt").write_text("travail\n", encoding="utf-8")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "travail")
        git(self.repo, "checkout", "-q", "main")
        self.version("0.2.0")
        git(self.repo, "commit", "-q", "-am", "release 0.2.0")
        git(self.repo, "checkout", "-q", "travail")
        # Les commandes git de check.py tournent dans REPO, valeur par défaut de `run` : le dépôt d'essai la remplace.
        self.saved = (check.REPO, check.run.__defaults__)
        check.REPO = self.repo
        check.run.__defaults__ = (self.repo, None)

    def tearDown(self):
        check.REPO, check.run.__defaults__ = self.saved
        self.dir.cleanup()

    def version(self, value):
        (self.plugin / ".claude-plugin" / "plugin.json").write_text(json.dumps({"name": "essai", "version": value}), encoding="utf-8")

    def test_la_version_apportee_par_la_fusion_passe(self):
        git(self.repo, "merge", "-q", "--no-ff", "--no-commit", "main")
        self.assertEqual(check.version_advance(self.plugin, rev=""), [])

    def test_une_version_posee_par_la_branche_et_deja_publiee_reste_refusee(self):
        self.version("0.2.0")
        git(self.repo, "add", ".")
        problems = check.version_advance(self.plugin, rev="")
        self.assertEqual(len(problems), 1)
        self.assertIn("n'avance pas sur main (0.2.0)", problems[0])


if __name__ == "__main__":
    unittest.main()
