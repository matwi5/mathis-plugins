"""Tests de la souplesse de scripts/check.py : l'arbre « Architecture » signalé à la fin, `--test` à
plusieurs fichiers, les tests touchés du pré-contrôle `--quick` : python3 -m unittest discover -s scripts/tests."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

README = "# essai\n\n## Architecture\n\n```\nessai/\n├── hooks/\n│   └── model.ts\n└── tests/\n    └── a.test.ts\n```\n"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class DeferredTreeTest(unittest.TestCase):
    """Un fichier absent de l'arbre ne coupe plus les contrôles : il est rendu, et échoue à la fin."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.plugin = Path(self.dir.name) / "essai"
        (self.plugin / "hooks").mkdir(parents=True)
        (self.plugin / "tests").mkdir()
        (self.plugin / "README.md").write_text(README, encoding="utf-8")
        (self.plugin / "hooks" / "model.ts").write_text("export const a = 1\n", encoding="utf-8")
        (self.plugin / "tests" / "a.test.ts").write_text("// a\n", encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def test_un_fichier_absent_de_l_arbre_est_rendu_sans_couper_les_controles(self):
        (self.plugin / "tests" / "b.test.ts").write_text("// b\n", encoding="utf-8")
        deferred = check.static_checks(self.plugin)
        self.assertEqual(len(deferred), 1)
        self.assertIn("essai/tests/b.test.ts", deferred[0])
        with self.assertRaises(check.Failed):
            check.fail_deferred(deferred)

    def test_une_entorse_aux_regles_du_code_coupe_toujours(self):
        (self.plugin / "hooks" / "model.ts").write_text("export const m = Math.max(...xs)\n", encoding="utf-8")
        with self.assertRaises(check.Failed):
            check.static_checks(self.plugin)

    def test_un_arbre_complet_ne_rend_rien(self):
        self.assertEqual(check.static_checks(self.plugin), [])
        check.fail_deferred([])


class TestArgsTest(unittest.TestCase):
    """`--test` prend plusieurs fichiers ; le plugin se nomme avant ou après eux."""

    def test_le_plugin_apres_les_fichiers(self):
        self.assertEqual(check.split_tests(["a.test.ts", "b.test.mjs", "flow-board"], [], {"flow-board"}),
                         (["a.test.ts", "b.test.mjs"], ["flow-board"]))

    def test_le_plugin_avant_les_fichiers(self):
        self.assertEqual(check.split_tests(["a.test.ts", "b.test.mjs"], ["flow-board"], {"flow-board"}),
                         (["a.test.ts", "b.test.mjs"], ["flow-board"]))

    def test_sans_plugin_rien_n_est_pris_pour_lui(self):
        self.assertEqual(check.split_tests(["a.test.ts"], [], {"flow-board"}), (["a.test.ts"], []))


class TouchedTestsTest(unittest.TestCase):
    """Les fichiers de test que `--quick` lance : modifiés face à HEAD (arbre ou index) ou nouveaux."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        self.plugin = self.repo / "plugins" / "essai"
        for rel in ["tests/a.test.ts", "tests/b.test.mjs", "tests/c.test.ts", "tests/aide.ts", "hooks/model.ts"]:
            path = self.plugin / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("// 1\n", encoding="utf-8")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")
        self.saved = (check.REPO, check.run.__defaults__)
        check.REPO = self.repo
        check.run.__defaults__ = (self.repo, None)

    def tearDown(self):
        check.REPO, check.run.__defaults__ = self.saved
        self.dir.cleanup()

    def test_modifies_indexes_et_nouveaux_seulement(self):
        (self.plugin / "tests" / "a.test.ts").write_text("// 2\n", encoding="utf-8")
        (self.plugin / "tests" / "b.test.mjs").write_text("// 2\n", encoding="utf-8")
        git(self.repo, "add", "plugins/essai/tests/b.test.mjs")
        (self.plugin / "tests" / "d.test.ts").write_text("// neuf\n", encoding="utf-8")
        (self.plugin / "tests" / "aide.ts").write_text("// 2\n", encoding="utf-8")
        (self.plugin / "hooks" / "model.ts").write_text("// 2\n", encoding="utf-8")
        self.assertEqual(check.touched_tests(self.plugin), ["tests/a.test.ts", "tests/b.test.mjs", "tests/d.test.ts"])

    def test_rien_de_touche(self):
        self.assertEqual(check.touched_tests(self.plugin), [])


if __name__ == "__main__":
    unittest.main()
