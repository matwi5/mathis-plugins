"""Tests de la règle commune des marqueurs « 0.xx.0 » (scripts/placeholders.py) : bump-version.py et le
contrôle de check.py disent les mêmes lignes remplacées. python3 -m unittest discover -s scripts/tests."""

import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402
import placeholders  # noqa: E402

SCRIPT = Path(__file__).resolve().parent.parent / "bump-version.py"
README = "plugins/essai/README.md"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class SameRuleTest(unittest.TestCase):
    """Une ligne commitée avec des espaces de fin, et deux lignes identiques dont une seule est commitée :
    les lignes que check.py annonce remplacées par bump-version.py sont celles qu'il remplace."""

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
        (self.repo / ".claude-plugin").mkdir()
        (self.repo / ".claude-plugin" / "marketplace.json").write_text(
            json.dumps({"plugins": [{"name": "essai", "version": "0.1.0"}]}), encoding="utf-8")
        self.readme = self.plugin / "README.md"
        self.readme.write_text("# Essai\n\nA (depuis la 0.xx.0)  \n\nB (depuis la 0.xx.0).\n", encoding="utf-8")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")
        # Une seconde ligne B, pas encore commitée, indexée avec la nouvelle version.
        self.readme.write_text(self.readme.read_text(encoding="utf-8") + "\nB (depuis la 0.xx.0).\n", encoding="utf-8")
        self.version("0.2.0")
        git(self.repo, "add", ".")
        self.saved = (check.REPO, check.run.__defaults__)
        check.REPO = self.repo
        check.run.__defaults__ = (self.repo, None)

    def tearDown(self):
        check.REPO, check.run.__defaults__ = self.saved
        self.dir.cleanup()

    def version(self, value):
        (self.plugin / ".claude-plugin" / "plugin.json").write_text(json.dumps({"name": "essai", "version": value}), encoding="utf-8")

    def test_check_et_bump_version_disent_les_memes_lignes(self):
        problems = check.leftover_placeholders(self.plugin, rev="")
        announced = {int(re.search(r"README\.md:(\d+) ", p).group(1)) for p in problems if "le remplace" in p}
        kept = {int(re.search(r"README\.md:(\d+) ", p).group(1)) for p in problems if "la retirer de l'index" in p}
        self.assertEqual((announced, kept), ({3, 5}, {7}))
        before = self.readme.read_text(encoding="utf-8").splitlines()
        res = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.repo), "essai", "0.2.0"],
                             capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        after = self.readme.read_text(encoding="utf-8").splitlines()
        replaced = {n for n, (a, b) in enumerate(zip(before, after), 1) if a != b}
        self.assertEqual(replaced, announced)
        self.assertIn("laissés dans du texte non commité : ligne 7", res.stdout)


class GitShowTest(unittest.TestCase):
    """Le contenu lu par git show est la sortie standard seule : un avertissement de git sur la sortie
    d'erreur ne s'y mêle pas."""

    def test_la_sortie_d_erreur_ne_se_mele_pas_au_contenu(self):
        done = subprocess.CompletedProcess(["git"], 0, stdout="ligne (depuis la 0.xx.0)\n", stderr="warning: bruit\n")
        with mock.patch.object(placeholders.subprocess, "run", return_value=done) as run:
            self.assertEqual(placeholders.git_show(".", f":{README}"), "ligne (depuis la 0.xx.0)\n")
        self.assertEqual(run.call_args.kwargs["stderr"], subprocess.DEVNULL)

    def test_un_objet_absent_rend_none(self):
        with tempfile.TemporaryDirectory() as root:
            git(root, "init", "-q")
            self.assertIsNone(placeholders.git_show(root, f":{README}"))


if __name__ == "__main__":
    unittest.main()
