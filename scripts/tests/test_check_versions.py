"""Tests du contrôle de version pendant une fusion (scripts/check.py, version_advance) et des marqueurs
« 0.xx.0 » lus dans l'index par le hook (leftover_placeholders) :
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


class PlaceholdersInIndexTest(unittest.TestCase):
    """Au commit de version, le hook lit les marqueurs « 0.xx.0 » du README de l'index : celui qu'une
    autre discussion n'a pas encore commité, et que `bump-version.py` laisse, ne le bloque pas."""

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
        self.readme = self.plugin / "README.md"
        self.readme.write_text("# Essai\n\nCommité (depuis la 0.xx.0).\n", encoding="utf-8")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")
        # La montée de version, indexée : le marqueur commité remplacé, comme le fait bump-version.py.
        self.version("0.2.0")
        self.readme.write_text("# Essai\n\nCommité (depuis la 0.2.0).\n", encoding="utf-8")
        git(self.repo, "add", ".")
        self.saved = (check.REPO, check.run.__defaults__)
        check.REPO = self.repo
        check.run.__defaults__ = (self.repo, None)

    def tearDown(self):
        check.REPO, check.run.__defaults__ = self.saved
        self.dir.cleanup()

    def version(self, value):
        (self.plugin / ".claude-plugin" / "plugin.json").write_text(json.dumps({"name": "essai", "version": value}), encoding="utf-8")

    def append(self, line):
        self.readme.write_text(self.readme.read_text(encoding="utf-8") + line, encoding="utf-8")

    def test_un_marqueur_non_commite_de_l_arbre_ne_bloque_pas_le_commit_de_version(self):
        self.append("\nPas commité (depuis la 0.xx.0).\n")
        self.assertEqual(check.leftover_placeholders(self.plugin, rev=""), [])
        # Le contrôle positif : lu sur le disque (check.sh), le même marqueur est signalé.
        self.assertEqual(len(check.leftover_placeholders(self.plugin)), 1)

    def test_un_marqueur_indexe_reste_refuse_avec_sa_ligne_de_l_index(self):
        self.append("\nIndexé (depuis la 0.xx.0).\n")
        git(self.repo, "add", ".")
        # Une ligne de plus sur le disque seulement : le numéro donné reste celui de l'index.
        self.readme.write_text("Ajout du disque\n" + self.readme.read_text(encoding="utf-8"), encoding="utf-8")
        problems = check.leftover_placeholders(self.plugin, rev="")
        self.assertEqual(len(problems), 1)
        self.assertIn("README.md:5 :", problems[0])
        # Le marqueur d'une autre discussion, indexé par un commit par chemin : le retirer de l'index, ne pas y écrire la version.
        self.assertIn("la retirer de l'index", problems[0])
        self.assertIn("sans y écrire la version", problems[0])
        self.assertNotIn("0.2.0", problems[0].split(" : ", 2)[2])

    def test_un_marqueur_commite_reste_refuse_et_bump_version_le_remplace(self):
        self.readme.write_text("# Essai\n\nCommité (depuis la 0.xx.0).\n", encoding="utf-8")
        git(self.repo, "add", ".")
        problems = check.leftover_placeholders(self.plugin, rev="")
        self.assertEqual(len(problems), 1)
        self.assertIn("scripts/bump-version.py essai 0.2.0 le remplace", problems[0])

    def test_sans_montee_le_blame_lit_les_lignes_de_l_index(self):
        # La version ne change pas : le marqueur d'avant la dernière montée reste signalé, à sa ligne de l'index.
        git(self.repo, "reset", "-q", "--hard")
        self.readme.write_text("Ajout indexé\n" + self.readme.read_text(encoding="utf-8"), encoding="utf-8")
        git(self.repo, "add", ".")
        self.readme.write_text("Disque 1\nDisque 2\n" + self.readme.read_text(encoding="utf-8"), encoding="utf-8")
        problems = check.leftover_placeholders(self.plugin, rev="")
        self.assertEqual(len(problems), 1)
        self.assertIn("README.md:4 : marqueur « 0.xx.0 » resté après la montée en 0.1.0", problems[0])


if __name__ == "__main__":
    unittest.main()
