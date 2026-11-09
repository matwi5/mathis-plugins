"""Tests de la suite Python du dépôt (`scripts/tests`) dans les contrôles : la cible `scripts/check.sh
scripts`, et le hook pre-commit (`check.py --staged`), qui la lance sur la copie de l'index quand un
fichier indexé est sous `scripts/` ou est `plugins/flow-board/hooks/register.tsx`.
python3 -m unittest discover -s scripts/tests."""

import io
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

GREEN = "import unittest\n\n\nclass Vert(unittest.TestCase):\n    def test_vert(self):\n        self.assertTrue(True)\n"
RED = "import unittest\n\n\nclass Rouge(unittest.TestCase):\n    def test_rouge(self):\n        self.assertEqual(1, 2)\n"
# Un test qui lit un script du dépôt d'essai à côté de lui (`scripts/valeur.py`) : vert tant qu'il vaut 1.
READS_SCRIPT = (
    "import sys\nimport unittest\nfrom pathlib import Path\n\n"
    "sys.path.insert(0, str(Path(__file__).resolve().parent.parent))\n"
    "import valeur  # noqa: E402\n\n\n"
    "class Valeur(unittest.TestCase):\n    def test_valeur_vaut_un(self):\n        self.assertEqual(valeur.VALEUR, 1)\n"
)
# Un test qui exige un dépôt git commité autour de lui (comme `test_export_exclus.py`, qui archive `HEAD`),
# et qui crée son propre dépôt jetable et y indexe un fichier (comme la plupart des tests du dépôt).
NEEDS_GIT = (
    "import subprocess\nimport tempfile\nimport unittest\nfrom pathlib import Path\n\n\n"
    "class Depot(unittest.TestCase):\n"
    "    def test_la_copie_est_un_depot_commite(self):\n"
    "        here = Path(__file__).resolve().parent\n"
    "        subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=here, check=True, capture_output=True)\n\n"
    "    def test_un_depot_jetable_a_son_propre_index(self):\n"
    "        with tempfile.TemporaryDirectory() as d:\n"
    "            subprocess.run(['git', 'init', '-q'], cwd=d, check=True, capture_output=True)\n"
    "            Path(d, 'jetable.txt').write_text('x')\n"
    "            subprocess.run(['git', 'add', 'jetable.txt'], cwd=d, check=True, capture_output=True)\n"
)


def git(cwd, *args, env=None):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True, env=env).stdout.strip()


def write(root, rel, text):
    path = Path(root) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class PythonSuiteTest(unittest.TestCase):
    """`python_tests` lance la suite d'un dossier `scripts/tests` et échoue en nommant ses tests rouges."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)

    def tearDown(self):
        self.dir.cleanup()

    def test_une_suite_verte_passe(self):
        write(self.root, "scripts/tests/test_vert.py", GREEN)
        with redirect_stdout(io.StringIO()) as out:
            check.python_tests(self.root)
        self.assertIn("Ran 1 test", out.getvalue())

    def test_un_test_rouge_fait_echouer_et_se_nomme(self):
        write(self.root, "scripts/tests/test_vert.py", GREEN)
        write(self.root, "scripts/tests/test_rouge.py", RED)
        with redirect_stdout(io.StringIO()), self.assertRaises(check.Failed) as err:
            check.python_tests(self.root)
        self.assertIn("test_rouge", str(err.exception))
        self.assertNotIn("test_vert", str(err.exception))


class RemoveTreeTest(unittest.TestCase):
    def test_un_dossier_aux_fichiers_en_lecture_seule_s_efface(self):
        base = Path(tempfile.mkdtemp(prefix="check-essai-"))
        write(base, "objets/ab/cdef", "x")
        (base / "objets" / "ab" / "cdef").chmod(0o444)
        check.remove_tree(base)
        self.assertFalse(base.exists())


class CibleScriptsTest(unittest.TestCase):
    """`check.sh scripts` lance la suite du dépôt, sans l'app desktop ni les contrôles d'un plugin."""

    def run_main(self, *argv):
        with mock.patch.object(sys, "argv", ["check.py", *argv]), redirect_stdout(io.StringIO()) as out:
            try:
                check.main()
                code = 0
            except SystemExit as exit_:
                code = exit_.code
        return code, out.getvalue()

    def test_la_cible_lance_la_suite_sans_l_app(self):
        with mock.patch.object(check, "python_tests") as suite, \
                mock.patch.object(check, "desktop_claude", side_effect=AssertionError("app demandée")), \
                mock.patch.object(check, "validate", side_effect=AssertionError("validate lancé")):
            code, _ = self.run_main("scripts")
        self.assertEqual(code, 0)
        suite.assert_called_once_with(check.REPO)

    def test_un_echec_de_la_suite_rend_un_code_non_nul(self):
        with mock.patch.object(check, "python_tests", side_effect=check.Failed("suite : échec")):
            code, out = self.run_main("scripts")
        self.assertEqual(code, 1)
        self.assertIn("suite : échec", out)

    def test_all_avec_une_option_rapide_laisse_la_suite_sans_refuser(self):
        for option, called in (("--quick", "quick_check"), ("--tsc", "typecheck")):
            with self.subTest(option=option), mock.patch.object(check, "python_tests") as suite, \
                    mock.patch.object(check, called) as ran, \
                    mock.patch.object(check, "check_repo_rules"), mock.patch.object(check, "fail_deferred"):
                code, out = self.run_main("--all", option)
                self.assertEqual(code, 0, out)
                suite.assert_not_called()
                self.assertTrue(ran.called)
                self.assertNotIn(check.TOOLS.get("scripts", check.PLUGINS / "scripts"), [c.args[0] for c in ran.call_args_list])

    def test_les_options_d_un_plugin_refusent_la_cible(self):
        for option in ("--quick", "--tsc", "--fix"):
            with self.subTest(option=option), mock.patch.object(check, "python_tests") as suite:
                code, out = self.run_main(option, "scripts")
                self.assertNotEqual(code, 0)
                self.assertIn("scripts", out)
                suite.assert_not_called()


class StagedSuiteTest(unittest.TestCase):
    """Le pre-commit lance la suite sur la copie de l'index, seulement quand l'index porte un fichier
    sous `scripts/` ou `plugins/flow-board/hooks/register.tsx`."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        write(self.repo, "README.md", "# Essai\n")
        write(self.repo, "scripts/valeur.py", "VALEUR = 1\n")
        write(self.repo, "scripts/tests/test_valeur.py", READS_SCRIPT)
        write(self.repo, "scripts/tests/test_depot.py", NEEDS_GIT)
        write(self.repo, "plugins/flow-board/hooks/register.tsx", "export const register = 1\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")
        self.saved = (check.REPO, check.run.__defaults__, check.validate, check.tool)
        check.REPO = self.repo
        check.run.__defaults__ = (self.repo, None)
        check.validate = lambda *args, **kwargs: None
        check.tool = lambda name: name

    def tearDown(self):
        check.REPO, check.run.__defaults__, check.validate, check.tool = self.saved
        self.dir.cleanup()

    def staged(self):
        with redirect_stdout(io.StringIO()) as out:
            check.staged()
        return out.getvalue()

    def counted_suites(self):
        runs = []
        original = check.python_tests

        def counted(root, *args, **kwargs):
            runs.append(Path(root))
            return original(root, *args, **kwargs)
        return runs, mock.patch.object(check, "python_tests", counted)

    def test_un_script_indexe_lance_la_suite_sur_la_copie(self):
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        git(self.repo, "add", "scripts/valeur.py")
        runs, patch = self.counted_suites()
        with patch:
            self.staged()
        self.assertEqual(len(runs), 1)
        self.assertNotEqual(runs[0].resolve(), self.repo.resolve())

    def test_register_indexe_lance_la_suite(self):
        write(self.repo, "plugins/flow-board/hooks/register.tsx", "export const register = 2\n")
        git(self.repo, "add", "plugins/flow-board/hooks/register.tsx")
        runs, patch = self.counted_suites()
        with patch:
            self.staged()
        self.assertEqual(len(runs), 1)

    def test_une_documentation_de_scripts_seule_lance_la_suite(self):
        write(self.repo, "scripts/LISEZ-MOI.md", "# Scripts\n")
        git(self.repo, "add", "scripts/LISEZ-MOI.md")
        runs, patch = self.counted_suites()
        with patch:
            self.staged()
        self.assertEqual(len(runs), 1)

    def test_sans_script_ni_register_pas_de_suite(self):
        write(self.repo, "README.md", "# Essai relu\n")
        write(self.repo, "plugins/flow-board/hooks/autre.ts", "export const autre = 1\n")
        for rel in ("README.md", "plugins/flow-board/hooks/autre.ts"):
            with self.subTest(rel=rel):
                git(self.repo, "add", rel)
                runs, patch = self.counted_suites()
                with patch:
                    self.staged()
                self.assertEqual(runs, [])
                git(self.repo, "reset", "-q", "--", rel)

    def test_un_script_casse_hors_index_ne_bloque_pas(self):
        write(self.repo, "scripts/LISEZ-MOI.md", "# Scripts\n")
        git(self.repo, "add", "scripts/LISEZ-MOI.md")
        write(self.repo, "scripts/valeur.py", "VALEUR = 2\n")
        self.staged()

    def test_le_meme_script_casse_indexe_bloque_et_nomme_le_test(self):
        write(self.repo, "scripts/valeur.py", "VALEUR = 2\n")
        git(self.repo, "add", "scripts/valeur.py")
        with self.assertRaises(check.Failed) as err:
            self.staged()
        self.assertIn("test_valeur_vaut_un", str(err.exception))

    def test_l_environnement_du_hook_ne_touche_pas_au_vrai_depot(self):
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        git(self.repo, "add", "scripts/valeur.py")
        index, head = git(self.repo, "ls-files", "-s"), git(self.repo, "rev-parse", "HEAD")
        hook_env = {"GIT_INDEX_FILE": str(self.repo / ".git" / "index"), "GIT_DIR": str(self.repo / ".git")}
        with mock.patch.dict(os.environ, hook_env):
            self.staged()
        self.assertEqual(git(self.repo, "ls-files", "-s"), index)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), head)
        self.assertEqual(git(self.repo, "rev-parse", "--abbrev-ref", "HEAD"), "main")


if __name__ == "__main__":
    unittest.main()
