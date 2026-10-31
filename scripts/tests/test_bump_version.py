"""Tests de scripts/bump-version.py sur un dépôt d'essai (--root) : python3 -m unittest discover -s scripts/tests."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "bump-version.py"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class PlaceholdersTest(unittest.TestCase):
    """Seuls les marqueurs « 0.xx.0 » du README commité sont remplacés : celui d'une ligne pas encore
    commitée (le travail d'une autre discussion) reste, et le rapport donne sa ligne."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        plugin = self.repo / "plugins" / "essai"
        (plugin / ".claude-plugin").mkdir(parents=True)
        (plugin / ".claude-plugin" / "plugin.json").write_text(json.dumps({"name": "essai", "version": "0.1.0"}), encoding="utf-8")
        (self.repo / ".claude-plugin").mkdir()
        (self.repo / ".claude-plugin" / "marketplace.json").write_text(
            json.dumps({"plugins": [{"name": "essai", "version": "0.1.0"}]}), encoding="utf-8")
        self.readme = plugin / "README.md"
        self.readme.write_text("# Essai\n\nVersion actuelle : **0.1.0**\n\nCommité (depuis la 0.xx.0).\n", encoding="utf-8")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")

    def tearDown(self):
        self.dir.cleanup()

    def bump(self):
        res = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.repo), "essai", "0.2.0"],
                             capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        return res.stdout

    def test_le_marqueur_commite_est_remplace_et_celui_non_commite_laisse_et_liste(self):
        self.readme.write_text(self.readme.read_text(encoding="utf-8") + "\nPas commité (depuis la 0.xx.0).\n", encoding="utf-8")
        out = self.bump()
        lines = self.readme.read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines[4], "Commité (depuis la 0.2.0).")
        self.assertEqual(lines[6], "Pas commité (depuis la 0.xx.0).")
        self.assertEqual(lines[2], "Version actuelle : **0.2.0**")
        self.assertIn("marqueurs « 0.xx.0 » remplacés : 1", out)
        self.assertIn("laissés dans du texte non commité : ligne 7", out)

    def test_sans_texte_non_commite_tout_marqueur_est_remplace(self):
        out = self.bump()
        self.assertNotIn("0.xx.0", self.readme.read_text(encoding="utf-8"))
        self.assertNotIn("laissés", out)


if __name__ == "__main__":
    unittest.main()
