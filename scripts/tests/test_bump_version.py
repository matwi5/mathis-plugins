"""Tests de scripts/bump-version.py sur un dépôt d'essai (--root) : python3 -m unittest discover -s scripts/tests."""

import json
import shutil
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


class RetiredTermsTest(unittest.TestCase):
    """Les lignes de `termes-retires.txt` à l'ancienne version, ajoutées depuis le dernier commit qui a
    changé la version de `plugin.json`, passent à la nouvelle ; les autres restent à l'octet près."""

    BASE = "# Termes retirés\n0.1.0\tancien\n\n0.0.9\tvieux\n"

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        self.plugin = self.repo / "plugins" / "essai"
        (self.plugin / ".claude-plugin").mkdir(parents=True)
        self.manifest = self.plugin / ".claude-plugin" / "plugin.json"
        self.manifest.write_text(json.dumps({"name": "essai", "version": "0.1.0"}), encoding="utf-8")
        (self.repo / ".claude-plugin").mkdir()
        (self.repo / ".claude-plugin" / "marketplace.json").write_text(
            json.dumps({"plugins": [{"name": "essai", "version": "0.1.0"}]}), encoding="utf-8")
        self.terms = self.plugin / "termes-retires.txt"
        self.terms.write_bytes(self.BASE.encode("utf-8"))
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "version 0.1.0")

    def tearDown(self):
        self.dir.cleanup()

    def commit(self, message):
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", message)

    def bump(self, root=None):
        res = subprocess.run([sys.executable, str(SCRIPT), "--root", str(root or self.repo), "essai", "0.2.0"],
                             capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        return res.stdout

    def test_la_ligne_ajoutee_depuis_le_commit_de_version_passe_a_la_nouvelle_version(self):
        self.terms.write_bytes((self.BASE + "0.1.0\tnouveau\n").encode("utf-8"))
        self.commit("retire « nouveau »")
        out = self.bump()
        self.assertEqual(self.terms.read_bytes().decode("utf-8"), self.BASE + "0.2.0\tnouveau\n")
        self.assertIn("0.2.0\tnouveau", out)

    def test_les_lignes_d_avant_le_commit_de_version_restent_a_l_octet_pres(self):
        # « ancien » porte l'ancienne version mais était là au commit de version ; « vieux » porte une
        # version plus ancienne ; le commentaire, la ligne vide et les fins CRLF ne bougent pas.
        # « nouveau » arrive avec un commit de plugin.json qui ne change pas sa version : ce commit-là
        # n'est pas le commit de version (le fichier tient sur une ligne, que tout commit change).
        base = "# Termes retirés\r\n0.1.0\tancien\r\n\r\n0.0.9\tvieux\r\n"
        self.terms.write_bytes(base.encode("utf-8"))
        self.commit("fins CRLF")
        self.manifest.write_text(json.dumps({"name": "essai", "version": "0.1.0", "description": "x"}), encoding="utf-8")
        self.terms.write_bytes((base + "0.1.0\tnouveau\r\n0.0.9\tvieux bis\r\n").encode("utf-8"))
        self.commit("description, version inchangée")
        out = self.bump()
        self.assertEqual(self.terms.read_bytes().decode("utf-8"), base + "0.2.0\tnouveau\r\n0.0.9\tvieux bis\r\n")
        self.assertIn("lignes passées de 0.1.0 à 0.2.0 : 1", out)

    def test_la_ligne_deplacee_pas_encore_commitee_est_signalee(self):
        # Une ligne absente de HEAD peut venir d'une autre discussion, qui attend sa propre version :
        # elle passe quand même (décision C10), mais le rapport la marque pour qu'on la relise.
        self.terms.write_bytes((self.BASE + "0.1.0\tcommite\n").encode("utf-8"))
        self.commit("retire « commite »")
        self.terms.write_bytes((self.BASE + "0.1.0\tcommite\n0.1.0\ten cours\n").encode("utf-8"))
        out = self.bump()
        self.assertEqual(self.terms.read_bytes().decode("utf-8"), self.BASE + "0.2.0\tcommite\n0.2.0\ten cours\n")
        self.assertIn("0.2.0\ten cours (pas encore commitée", out)
        self.assertNotIn("0.2.0\tcommite (pas encore", out)

    def test_sans_ligne_nouvelle_le_fichier_n_est_pas_touche(self):
        out = self.bump()
        self.assertEqual(self.terms.read_bytes().decode("utf-8"), self.BASE)
        self.assertIn("lignes passées de 0.1.0 à 0.2.0 : 0", out)

    def test_sans_fichier_de_termes_rien_n_est_casse(self):
        self.terms.unlink()
        self.commit("sans termes")
        out = self.bump()
        self.assertFalse(self.terms.exists())
        self.assertIn("aucune ligne déplacée (pas de fichier de termes retirés)", out)
        self.assertIn('"version": "0.2.0"', self.manifest.read_text(encoding="utf-8"))

    def copy(self):
        """Une copie du plugin et de la marketplace hors de ce dépôt, sa liste de termes augmentée."""
        copie = tempfile.TemporaryDirectory()
        self.addCleanup(copie.cleanup)
        root = Path(copie.name)
        shutil.copytree(self.repo / "plugins", root / "plugins")
        shutil.copytree(self.repo / ".claude-plugin", root / ".claude-plugin")
        terms = root / "plugins" / "essai" / "termes-retires.txt"
        terms.write_bytes((self.BASE + "0.1.0\tnouveau\n").encode("utf-8"))
        return root, terms

    def test_sans_commit_de_version_rien_n_est_deplace_et_le_rapport_le_dit(self):
        # Un dépôt dont l'historique n'a jamais porté plugin.json (plugin neuf, pas encore commité).
        root, terms = self.copy()
        git(root, "init", "-q", "-b", "main")
        git(root, "config", "user.name", "essai")
        git(root, "config", "user.email", "essai@localhost")
        git(root, "config", "commit.gpgsign", "false")
        git(root, "commit", "-q", "--allow-empty", "-m", "vide")
        out = self.bump(root)
        self.assertEqual(terms.read_bytes().decode("utf-8"), self.BASE + "0.1.0\tnouveau\n")
        self.assertIn("aucune ligne déplacée (aucun commit n'a posé sa version)", out)

    def test_sans_git_rien_n_est_deplace_et_le_rapport_le_dit(self):
        root, terms = self.copy()
        out = self.bump(root)
        self.assertEqual(terms.read_bytes().decode("utf-8"), self.BASE + "0.1.0\tnouveau\n")
        self.assertIn("aucune ligne déplacée (pas de dépôt git)", out)


if __name__ == "__main__":
    unittest.main()
