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


class OtherStorageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="test-stockage-"))
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


if __name__ == "__main__":
    unittest.main()
