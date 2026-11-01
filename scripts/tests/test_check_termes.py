"""Tests des termes retirés (règle et références d'un plugin) et des termes de l'export public dans
les fichiers d'un plugin (scripts/check.py) : python3 -m unittest discover -s scripts/tests."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402


class RetiredTermsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        self.plugin = self.root / "plugins" / "essai"
        (self.plugin / "reference").mkdir(parents=True)
        (self.root / "config" / "rules").mkdir(parents=True)
        (self.plugin / "termes-retires.txt").write_text("0.2.0\tvague suivante\n", encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def test_un_terme_retire_dans_la_regle_du_plugin_est_refuse(self):
        (self.root / "config" / "rules" / "essai.md").write_text("Texte\nlancer la vague suivante\n", encoding="utf-8")
        problems = check.retired_terms(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("config/rules/essai.md:2", problems[0])

    def test_un_terme_retire_dans_une_reference_est_refuse(self):
        (self.plugin / "reference" / "procedure.md").write_text("la vague suivante\n", encoding="utf-8")
        problems = check.retired_terms(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("essai/reference/procedure.md:1", problems[0])

    def test_la_regle_d_un_autre_plugin_n_est_pas_lue(self):
        (self.root / "config" / "rules" / "autre.md").write_text("la vague suivante\n", encoding="utf-8")
        self.assertEqual(check.retired_terms(self.plugin), [])


# Ces valeurs que l'export refuse s'écrivent par morceaux : ce fichier part dans la version publique.
MAIL = "git" + "@" + "example.com"
HOME = "/Us" + "ers/quelquun"
HAS_EXPORT = (Path(check.__file__).resolve().parent / "export_public.py").is_file()


@unittest.skipUnless(HAS_EXPORT, "sans scripts/export_public.py (version publique)")
class ExportTermsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.plugin = Path(self.dir.name) / "essai"
        (self.plugin / "tests").mkdir(parents=True)
        self.denylist = Path(self.dir.name) / "denylist.txt"
        patcher = mock.patch.object(check, "EXPORT_DENYLIST", self.denylist)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.dir.cleanup()

    def test_une_adresse_mail_dans_un_test_est_refusee(self):
        (self.plugin / "tests" / "a.test.ts").write_text(f"const a = 1\nconst m = '{MAIL}'\n", encoding="utf-8")
        problems = check.export_terms(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("essai/tests/a.test.ts:2", problems[0])
        self.assertIn("adresse mail", problems[0])

    def test_un_terme_interdit_et_un_dossier_personnel_sont_refuses(self):
        self.denylist.write_text("# commentaire\nEmployeurX\n", encoding="utf-8")
        (self.plugin / "README.md").write_text(f"chez employeurx\nvoir {HOME}/projet\n", encoding="utf-8")
        problems = check.export_terms(self.plugin)
        self.assertEqual(len(problems), 2)
        self.assertTrue(any("README.md:1" in p and "terme interdit" in p for p in problems))
        self.assertTrue(any("README.md:2" in p and "dossier personnel" in p for p in problems))

    def test_un_nom_de_fichier_est_controle_aussi(self):
        self.denylist.write_text("EmployeurX\n", encoding="utf-8")
        (self.plugin / "tests" / "employeurx.json").write_text("{}\n", encoding="utf-8")
        problems = check.export_terms(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("essai/tests/employeurx.json (nom)", problems[0])

    def test_les_adresses_permises_et_les_noms_factices_passent(self):
        (self.plugin / "tests" / "b.test.ts").write_text("noreply@anthropic.com /Users/moi/x C:\\Users\\m\\p\n", encoding="utf-8")
        self.assertEqual(check.export_terms(self.plugin), [])

    def test_les_plugins_du_depot_passent(self):
        with mock.patch.object(check, "EXPORT_DENYLIST", check.REPO / "config" / "personal" / "public-denylist.txt"):
            for plugin in sorted(check.PLUGINS.glob("*/.claude-plugin/plugin.json")):
                self.assertEqual(check.export_terms(plugin.parent.parent), [], plugin.parent.parent.name)


if __name__ == "__main__":
    unittest.main()
