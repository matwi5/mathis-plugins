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


# Un test qui lit `HEAD` du dépôt autour de lui : vert tant que `HEAD` porte la base de `valeur.py`.
READS_HEAD = (
    "import subprocess\nimport unittest\nfrom pathlib import Path\n\n\n"
    "class Head(unittest.TestCase):\n    def test_head_vaut_la_base(self):\n"
    "        here = Path(__file__).resolve().parent.parent.parent\n"
    "        out = subprocess.run(['git', 'show', 'HEAD:scripts/valeur.py'], cwd=here, capture_output=True, text=True)\n"
    "        self.assertEqual(out.stdout, 'VALEUR = 1\\n')\n"
)
# Un test qui lit le README du dépôt : rouge dès qu'il change.
READS_README = (
    "import unittest\nfrom pathlib import Path\n\n\n"
    "class Readme(unittest.TestCase):\n    def test_readme_inchange(self):\n"
    "        here = Path(__file__).resolve().parent.parent.parent\n"
    "        self.assertEqual((here / 'README.md').read_text(), '# Essai\\n')\n"
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

    def setUp(self):
        # La suite est simulée ici, sur le vrai dépôt : son empreinte ne doit jamais s'écrire, sans quoi le
        # pre-commit sauterait ensuite la suite pour un contenu qu'elle n'a jamais vu passer. La suite et
        # son empreinte passent par `suite_and_remember` (SuiteMemoryTest la lance, sur un dépôt jetable).
        patcher = mock.patch.object(check, "suite_and_remember")
        self.suite = patcher.start()
        self.addCleanup(patcher.stop)

    def run_main(self, *argv):
        with mock.patch.object(sys, "argv", ["check.py", *argv]), redirect_stdout(io.StringIO()) as out:
            try:
                check.main()
                code = 0
            except SystemExit as exit_:
                code = exit_.code
        return code, out.getvalue()

    def test_la_cible_lance_la_suite_sans_l_app(self):
        with mock.patch.object(check, "desktop_claude", side_effect=AssertionError("app demandée")), \
                mock.patch.object(check, "validate", side_effect=AssertionError("validate lancé")):
            code, _ = self.run_main("scripts")
        self.assertEqual(code, 0)
        self.suite.assert_called_once_with()

    def test_un_echec_de_la_suite_rend_un_code_non_nul(self):
        self.suite.side_effect = check.Failed("suite : échec")
        code, out = self.run_main("scripts")
        self.assertEqual(code, 1)
        self.assertIn("suite : échec", out)

    def test_all_avec_une_option_rapide_laisse_la_suite_sans_refuser(self):
        suite = self.suite
        for option, called in (("--quick", "quick_check"), ("--tsc", "typecheck")):
            with self.subTest(option=option), \
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


class SuiteMemoryTest(unittest.TestCase):
    """L'empreinte du dernier passage vert de la suite (`suite_and_remember`, `suite_passed_already`) : le
    pre-commit saute la suite quand l'index porte exactement les déclencheurs et le contexte de ce passage
    (le dépôt hors `travail/` et `ETAT_DU_PROJET.md`, la version de Python), et seulement alors. Invariant : la suite n'est jamais sautée pour un contenu des déclencheurs différent de celui de
    son dernier passage vert ; un worktree n'écrit que sa propre empreinte."""

    setUp = StagedSuiteTest.setUp
    tearDown = StagedSuiteTest.tearDown
    staged = StagedSuiteTest.staged
    counted_suites = StagedSuiteTest.counted_suites

    def at(self, repo):
        check.REPO = repo
        check.run.__defaults__ = (repo, None)

    def passed(self):
        """`check.sh scripts` vert sur l'arbre de travail : rend le fichier de son empreinte."""
        with redirect_stdout(io.StringIO()):
            check.suite_and_remember()
        return check.suite_passed_path()

    def staged_runs(self):
        runs, patch = self.counted_suites()
        with patch:
            out = self.staged()
        return runs, out

    def test_le_contenu_d_un_passage_vert_saute_la_suite_et_le_dit(self):
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        self.assertTrue(self.passed().is_file())
        git(self.repo, "add", "scripts/valeur.py")
        runs, out = self.staged_runs()
        self.assertEqual(runs, [])
        self.assertIn("identique au dernier passage vert", out)
        self.assertIn("suite sautée", out)

    def test_un_seul_fichier_different_sous_les_declencheurs_relance_la_suite(self):
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        self.passed()
        for rel, text in (("scripts/valeur.py", "VALEUR = 1  # relu encore\n"),
                          ("scripts/LISEZ-MOI.md", "# Scripts\n"),
                          ("plugins/flow-board/hooks/register.tsx", "export const register = 2\n")):
            with self.subTest(rel=rel):
                # Chaque cas part du contenu du passage vert : un seul fichier diffère à la fois.
                write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
                write(self.repo, "plugins/flow-board/hooks/register.tsx", "export const register = 1\n")
                (self.repo / "scripts" / "LISEZ-MOI.md").unlink(missing_ok=True)
                git(self.repo, "reset", "-q")
                git(self.repo, "add", "scripts/valeur.py")
                self.assertEqual(self.staged_runs()[0], [])
                write(self.repo, rel, text)
                git(self.repo, "add", rel)
                runs, _ = self.staged_runs()
                self.assertEqual(len(runs), 1)

    def test_un_fichier_non_suivi_du_passage_vert_ne_fait_pas_sauter_un_index_sans_lui(self):
        # L'arbre testé portait un fichier de plus que l'index : ce n'est pas le même contenu.
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        write(self.repo, "scripts/neuf.py", "NEUF = 1\n")
        self.passed()
        git(self.repo, "add", "scripts/valeur.py")
        runs, _ = self.staged_runs()
        self.assertEqual(len(runs), 1)

    def test_un_echec_de_la_suite_n_ecrit_jamais_d_empreinte(self):
        write(self.repo, "scripts/valeur.py", "VALEUR = 2\n")
        with self.assertRaises(check.Failed):
            self.passed()
        self.assertFalse(check.suite_passed_path().exists())

    def test_une_empreinte_absente_illisible_vide_ou_hors_forme_fait_tourner_la_suite(self):
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        git(self.repo, "add", "scripts/valeur.py")
        path = check.suite_passed_path()
        for damage in ("absente", "", "\n\n", "pas-une-empreinte\n", "x" * 1000, b"\xff\xfe", "dossier"):
            with self.subTest(damage=damage):
                if path.is_dir():
                    path.rmdir()
                elif path.exists():
                    path.unlink()
                path.parent.mkdir(parents=True, exist_ok=True)
                if damage == "dossier":
                    path.mkdir()
                elif isinstance(damage, bytes):
                    path.write_bytes(damage)
                elif damage != "absente":
                    path.write_text(damage, encoding="utf-8")
                runs, _ = self.staged_runs()
                self.assertEqual(len(runs), 1)

    def test_le_passage_vert_d_un_autre_worktree_compte_lu_seulement_et_contexte_compris(self):
        write(self.repo, ".gitignore", ".claude/\n")
        git(self.repo, "add", ".gitignore")
        git(self.repo, "commit", "-q", "-m", "ignore")
        wt = self.repo / ".claude" / "worktrees" / "groupe-x"
        git(self.repo, "worktree", "add", "-q", "-b", "worktree-groupe-x", str(wt))
        write(wt, "scripts/valeur.py", "VALEUR = 1  # du worktree\n")
        git(wt, "commit", "-q", "-am", "ticket")
        self.at(wt)
        mark = self.passed()
        before = mark.read_text(encoding="utf-8")
        self.assertEqual(len(before.split()), 2)
        self.at(self.repo)
        git(self.repo, "merge", "-q", "--no-ff", "--no-commit", "worktree-groupe-x")
        self.assertTrue(check.suite_passed_already())
        # Lue seulement : le clone principal n'a rien écrit, l'empreinte du worktree n'a pas bougé.
        self.assertFalse(Path(git(self.repo, "rev-parse", "--path-format=absolute", "--git-path",
                                  f"check-ok/{check.SUITE_MARK}")).exists())
        self.assertEqual(mark.read_text(encoding="utf-8"), before)
        # Un fichier hors des déclencheurs changé dans la fusion : le contexte n'est plus celui du passage.
        write(self.repo, "README.md", "# Essai changé\n")
        git(self.repo, "add", "README.md")
        self.assertFalse(check.suite_passed_already())

    def test_une_empreinte_sans_contexte_ou_avec_une_ligne_de_plus_ne_compte_nulle_part(self):
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        mark = self.passed()
        git(self.repo, "add", "scripts/valeur.py")
        self.assertTrue(check.suite_passed_already())
        lines = mark.read_text(encoding="utf-8").split()
        for text in (lines[0] + "\n", "\n".join(lines + ["autre"]) + "\n"):
            with self.subTest(text=text):
                mark.write_text(text, encoding="utf-8")
                self.assertFalse(check.suite_passed_already())

    def test_la_suite_tourne_sur_une_copie_commitee_comme_au_pre_commit(self):
        # Un test qui lit HEAD : vert sur l'arbre (HEAD est le dernier commit), rouge sur la copie de
        # l'index, où HEAD porte le contenu à commiter. Le passage de check.sh scripts doit voir ce rouge.
        write(self.repo, "scripts/tests/test_head.py", READS_HEAD)
        git(self.repo, "add", "scripts/tests/test_head.py")
        git(self.repo, "commit", "-q", "-m", "test de HEAD")
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        with self.assertRaises(check.Failed) as caught:
            self.passed()
        self.assertIn("test_head_vaut_la_base", str(caught.exception))
        self.assertFalse(check.suite_passed_path().exists())
        git(self.repo, "add", "scripts/valeur.py")
        with self.assertRaises(check.Failed):
            self.staged_runs()

    def test_un_passage_rouge_retire_l_empreinte_du_vert_d_avant(self):
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        self.passed()
        write(self.repo, "README.md", "# Essai, lu par un test qui casse\n")
        write(self.repo, "scripts/tests/test_lit_readme.py", READS_README)
        with self.assertRaises(check.Failed):
            self.passed()
        self.assertFalse(check.suite_passed_path().exists())
        git(self.repo, "add", "scripts/valeur.py")
        runs, _ = self.staged_runs()
        self.assertEqual(len(runs), 1)

    def test_un_commit_partiel_hors_des_declencheurs_relance_la_suite(self):
        # L'arbre testé vert portait un README changé ; le commit ne prend que le script : la copie de
        # l'index (ancien README, nouveau script) n'a jamais été testée.
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        write(self.repo, "README.md", "# Essai changé\n")
        self.passed()
        git(self.repo, "add", "scripts/valeur.py")
        runs, out = self.staged_runs()
        self.assertEqual(len(runs), 1)
        self.assertIn("un passage vert a ces déclencheurs, mais pas le reste du dépôt", out)
        git(self.repo, "add", "README.md")
        runs, _ = self.staged_runs()
        self.assertEqual(runs, [])

    def test_un_arbre_change_pendant_la_suite_n_entre_pas_dans_l_empreinte(self):
        # La suite tourne sur la copie figée avant elle : l'empreinte est celle de cette copie, pas de ce
        # que l'arbre devient pendant qu'elle tourne (une autre discussion du clone principal).
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        original = check.index_suite

        def changes_tree(tree):
            write(self.repo, "scripts/valeur.py", "VALEUR = 1  # changé pendant la suite\n")
            return original(tree)
        with mock.patch.object(check, "index_suite", changes_tree):
            self.passed()
        git(self.repo, "add", "scripts/valeur.py")
        runs, _ = self.staged_runs()
        self.assertEqual(len(runs), 1)
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        git(self.repo, "add", "scripts/valeur.py")
        runs, _ = self.staged_runs()
        self.assertEqual(runs, [])

    def test_sans_filemode_un_script_executable_garde_son_mode_et_la_suite_se_saute(self):
        # Sous Windows, core.filemode vaut faux : un index temporaire neuf noterait 100644 un script suivi
        # en 100755, et l'empreinte ne serait jamais égale à celle de l'index.
        write(self.repo, "scripts/outil.py", "print(1)\n")
        git(self.repo, "add", "--chmod=+x", "scripts/outil.py")
        git(self.repo, "commit", "-q", "-m", "outil")
        (self.repo / "scripts" / "outil.py").chmod(0o644)
        git(self.repo, "config", "core.filemode", "false")
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        self.passed()
        git(self.repo, "add", "scripts/valeur.py")
        self.assertTrue(check.suite_passed_already())

    def test_une_autre_version_de_python_relance_la_suite(self):
        write(self.repo, "scripts/valeur.py", "VALEUR = 1  # relu\n")
        self.passed()
        git(self.repo, "add", "scripts/valeur.py")
        with mock.patch.object(check.sys, "version", "2.7.0 (autre)"):
            self.assertFalse(check.suite_passed_already())


if __name__ == "__main__":
    unittest.main()
