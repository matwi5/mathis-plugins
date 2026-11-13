"""Tests de la relance dans l'autre mode de stockage (scripts/check.py, storage_mode, both_storage_tests,
other_storage_tests) : un fichier de test qui porte « Stockage : les deux modes » repart sur une copie
du plugin posée dans le mode qu'il n'a pas eu. python3 -m unittest discover -s scripts/tests."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402


class StorageModeTest(unittest.TestCase):
    def test_mode_suit_le_dossier_claude(self):
        self.assertEqual(check.storage_mode("/Users/x/.claude/worktrees/w/plugins/flow-board"), "fichier")
        self.assertEqual(check.storage_mode("/Users/x/.Claude/plugins/flow-board"), "fichier")
        self.assertEqual(check.storage_mode("/Users/x/mathis-plugins/plugins/flow-board"), "$.store")
        self.assertEqual(check.storage_mode("/Users/x/claude/plugins/flow-board"), "$.store")


class PluginFixture(unittest.TestCase):
    """Un faux plugin flow-board hors de `.claude/` : deux fichiers marqués, un non marqué, une aide."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="test-stockage-")).resolve()
        self.plugin = self.tmp / "flow-board"
        (self.plugin / "tests").mkdir(parents=True)
        (self.plugin / "hooks").mkdir()
        (self.plugin / "hooks" / "register.tsx").write_text("export const register = () => {}\n", encoding="utf-8")
        (self.plugin / "tests" / "a.test.ts").write_text("// Stockage : les deux modes.\n", encoding="utf-8")
        (self.plugin / "tests" / "b.test.ts").write_text("// rien\n", encoding="utf-8")
        (self.plugin / "tests" / "c.test.tsx").write_text("// Stockage : les deux modes.\n", encoding="utf-8")
        (self.plugin / "tests" / "aide.ts").write_text("// Stockage : les deux modes (une aide, pas un test).\n", encoding="utf-8")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)


class OtherStorageTest(PluginFixture):
    def test_fichiers_marques_seuls_parmi_les_cibles(self):
        self.assertEqual(check.both_storage_tests(self.plugin, None), [Path("tests/a.test.ts"), Path("tests/c.test.tsx")])
        self.assertEqual(check.both_storage_tests(self.plugin, {Path("tests/a.test.ts"), Path("tests/b.test.ts")}), [Path("tests/a.test.ts")])
        self.assertEqual(check.both_storage_tests(self.plugin, {Path("tests/b.test.ts")}), [])

    def _run(self, ran_at, targets=None):
        seen = []

        def fake_step(label, argv, *_):
            copy = Path(argv[-1])
            seen.append((label, check.storage_mode(copy), sorted(p.name for p in copy.rglob("*.test.*")), (copy / "tests" / "aide.ts").is_file()))
        with mock.patch.object(check, "step", fake_step), mock.patch.object(check, "shown_dir", lambda p: "plugins/flow-board"):
            check.other_storage_tests(self.plugin, ran_at, "claude", "terminal 9", targets)
        return seen

    def test_lance_dans_l_autre_mode(self):
        # Parti d'un dossier hors de .claude/ ($.store) : la relance est sous un dossier .claude/ (fichier).
        [(label, mode, tests, helper)] = self._run(self.plugin)
        self.assertEqual(mode, "fichier")
        self.assertEqual(tests, ["a.test.ts", "c.test.tsx"])
        self.assertTrue(helper)
        self.assertIn("stockage fichier", label)
        # Parti d'un worktree sous .claude/ (fichier) : la relance est hors de lui ($.store).
        [(label, mode, tests, _)] = self._run(Path("/Users/x/.claude/worktrees/w/plugins/flow-board"))
        self.assertEqual(mode, "$.store")
        self.assertIn("stockage $.store", label)

    def test_rien_sans_fichier_marque(self):
        self.assertEqual(self._run(self.plugin, {Path("tests/b.test.ts")}), [])


class FirstPassTest(PluginFixture):
    """La première passe de `claude plugin test` (suite complète, `--test`, pre-commit) tourne en mode
    fichier partout, même depuis un dossier hors de `.claude/` ; la relance des fichiers marqués, en `$.store`."""

    def _steps(self, call):
        seen = []

        def fake_step(label, argv, *_):
            copy = Path(argv[-1])
            seen.append((label, check.storage_mode(copy), sorted(p.name for p in copy.rglob("*.test.*"))))

        def fake_run(argv, *_):
            return 0, "9.9.9 (Claude Code)\n"
        with mock.patch.object(check, "step", fake_step), mock.patch.object(check, "run", fake_run), \
                mock.patch.object(check, "shown_dir", lambda p: "plugins/flow-board"), \
                mock.patch.object(check, "tool", lambda name: name):
            call()
        return seen

    def test_suite_complete_hors_de_claude(self):
        # Le clone principal ou la copie de l'index du pre-commit : hors de .claude/.
        self.assertEqual(check.storage_mode(self.plugin), "$.store")
        [(first, mode, tests), (again, other, marked)] = self._steps(lambda: check.plugin_tests(self.plugin, "claude", "terminal 9"))
        self.assertEqual(mode, "fichier")
        self.assertEqual(tests, ["a.test.ts", "b.test.ts", "c.test.tsx"])
        self.assertIn("stockage fichier", first)
        self.assertEqual(other, "$.store")
        self.assertEqual(marked, ["a.test.ts", "c.test.tsx"])
        self.assertIn("stockage $.store", again)
        # Les copies temporaires sont parties, le plugin reste intact.
        self.assertTrue((self.plugin / "tests" / "b.test.ts").is_file())

    def test_suite_complete_deja_en_mode_fichier(self):
        # Un worktree, sous .claude/ : la première passe tourne en place.
        plugin = self.tmp / ".claude" / "worktrees" / "w" / "plugins" / "flow-board"
        import shutil
        shutil.copytree(self.plugin, plugin)
        steps = self._steps(lambda: check.plugin_tests(plugin, "claude", "terminal 9"))
        self.assertIn("stockage fichier", steps[0][0])
        self.assertEqual([s[1] for s in steps], ["fichier", "$.store"])

    def test_test_d_un_fichier(self):
        names = [str(self.plugin / "tests" / "a.test.ts"), str(self.plugin / "tests" / "b.test.ts")]
        with mock.patch.object(check, "REPO", self.tmp):
            [(first, mode, tests), (again, other, marked)] = self._steps(lambda: check.single_test(self.plugin, names))
        self.assertEqual(mode, "fichier")
        self.assertEqual(tests, ["a.test.ts", "b.test.ts"])
        self.assertIn("stockage fichier", first)
        self.assertEqual((other, marked), ("$.store", ["a.test.ts"]))
        self.assertIn("stockage $.store", again)


if __name__ == "__main__":
    unittest.main()
