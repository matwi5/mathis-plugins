"""Tests de `check.sh --test <fichiers> --contre <ref> <plugin>` (scripts/check.py, `single_test`,
`resolve_ref`, `hooks_from`) : les tests de l'arbre de travail tournent contre `hooks/` du plugin à une
autre référence, dans la copie temporaire, sans rien écrire dans l'arbre ni l'index d'un dépôt jetable.
python3 -m unittest discover -s scripts/tests."""

import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class RefRepo(unittest.TestCase):
    """Un dépôt jetable : `hooks/` à v1 (avec `ancien.ts`), puis v2 (sans lui, avec `neuf.ts`), puis
    l'arbre de travail à v3 avec un fichier non suivi ; le test du plugin reste dans l'arbre."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="test-contre-")).resolve()
        self.repo = self.tmp / "depot"
        self.plugin = self.repo / "plugins" / "essai"
        (self.plugin / "hooks" / "sous").mkdir(parents=True)
        (self.plugin / "tests").mkdir()
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        self.write("hooks/model.ts", "v1\n")
        self.write("hooks/sous/aide.ts", "aide v1\n")
        self.write("hooks/ancien.ts", "ancien\n")
        self.write("tests/essai.test.ts", "test v1\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "v1")
        self.v1 = git(self.repo, "rev-parse", "HEAD")
        git(self.repo, "tag", "v1")
        self.write("hooks/model.ts", "v2\n")
        (self.plugin / "hooks" / "ancien.ts").unlink()
        self.write("hooks/neuf.ts", "neuf\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "v2")
        self.write("hooks/model.ts", "v3\n")
        self.write("hooks/non-suivi.ts", "local\n")
        self.write("tests/essai.test.ts", "test de l'arbre\n")
        git(self.repo, "add", str(self.plugin / "tests" / "essai.test.ts"))
        patcher = mock.patch.multiple(check, REPO=self.repo, tool=lambda name: name)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, rel, text):
        path = self.plugin / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def state(self):
        return git(self.repo, "status", "--porcelain", "--untracked-files=all"), git(self.repo, "diff", "--cached")

    def single(self, names, against):
        """`single_test` avec `claude` simulé : rend ce que chaque `claude plugin test` a vu de sa copie."""
        seen = []
        real_run = check.run

        def fake_run(args, timeout, cwd=None, env=None):
            if args[0] == "claude":
                return 0, "9.9.9 (Claude Code)"
            return real_run(args, timeout, cwd=cwd or self.repo, env=env)

        def fake_step(title, argv, *_):
            copy = Path(argv[-1])
            seen.append((title, {p.relative_to(copy).as_posix(): p.read_text(encoding="utf-8")
                                 for p in copy.rglob("*") if p.is_file()}))
        with mock.patch.object(check, "run", fake_run), mock.patch.object(check, "step", fake_step), \
                redirect_stdout(io.StringIO()):
            check.single_test(self.plugin, names, against)
        return seen


class AgainstRefTest(RefRepo):
    def test_la_copie_porte_hooks_de_la_reference_et_les_tests_de_l_arbre(self):
        before = self.state()
        [(title, files)] = self.single(["tests/essai.test.ts"], "v1")
        self.assertIn("hooks à v1", title)
        self.assertEqual(files["hooks/model.ts"], "v1\n")
        self.assertEqual(files["hooks/sous/aide.ts"], "aide v1\n")
        self.assertEqual(files["hooks/ancien.ts"], "ancien\n")
        self.assertNotIn("hooks/neuf.ts", files)
        self.assertNotIn("hooks/non-suivi.ts", files)
        self.assertEqual(files["tests/essai.test.ts"], "test de l'arbre\n")
        # Rien n'a bougé dans l'arbre de travail ni l'index.
        self.assertEqual(self.state(), before)
        self.assertEqual((self.plugin / "hooks" / "model.ts").read_text(encoding="utf-8"), "v3\n")

    def test_un_fichier_absent_a_la_reference_est_absent_de_la_copie(self):
        [(_, files)] = self.single(["tests/essai.test.ts"], "HEAD")
        self.assertEqual(files["hooks/model.ts"], "v2\n")
        self.assertIn("hooks/neuf.ts", files)
        self.assertNotIn("hooks/ancien.ts", files)

    def test_sans_contre_la_copie_garde_l_arbre(self):
        [(title, files)] = self.single(["tests/essai.test.ts"], None)
        self.assertNotIn("hooks à", title)
        self.assertEqual(files["hooks/model.ts"], "v3\n")

    def test_une_reference_en_option_ou_inconnue_est_refusee(self):
        before = self.state()
        for ref in ("-v", "--output=x", "inconnue", "", "v1:plugins"):
            with self.subTest(ref=ref), self.assertRaises(check.Failed) as caught:
                self.single(["tests/essai.test.ts"], ref)
            self.assertIn("--contre", str(caught.exception))
        self.assertEqual(self.state(), before)

    def test_les_invisibles_se_cherchent_dans_hooks_a_la_reference(self):
        # À v1, un séparateur brut dans hooks/ : c'est ce code que la copie chargerait.
        self.write("hooks/model.ts", "v1" + chr(0x2028) + "\n")
        git(self.repo, "add", str(self.plugin / "hooks" / "model.ts"))
        git(self.repo, "commit", "-q", "-m", "invisible")
        git(self.repo, "tag", "brut")
        self.write("hooks/model.ts", "v3 propre\n")
        with self.assertRaises(check.Failed) as caught:
            self.single(["tests/essai.test.ts"], "brut")
        self.assertIn("essai/hooks/model.ts@", str(caught.exception))
        self.assertIn("U+2028", str(caught.exception))
        # L'inverse : un séparateur brut dans hooks/ de l'arbre, remplacé dans la copie, ne bloque pas.
        self.write("hooks/model.ts", "v3" + chr(0x2028) + "\n")
        [(_, files)] = self.single(["tests/essai.test.ts"], "v1")
        self.assertEqual(files["hooks/model.ts"], "v1\n")

    def test_un_test_mjs_est_refuse_avec_contre(self):
        self.write("tests/lecture.test.mjs", "// node\n")
        with self.assertRaises(check.Failed) as caught:
            self.single(["tests/lecture.test.mjs"], "v1")
        self.assertIn(".test.mjs", str(caught.exception))
        self.assertIn("tourne en place", str(caught.exception))


class OutsideTestFileTest(RefRepo):
    """Un fichier de test gardé hors du plugin (`travail/<sujet>/tests/`) : copié dans `tests/` de la
    copie, sous son nom, avec `--contre` aussi ; les formes qui ne peuvent pas tourner sont refusées."""

    DIAG = "travail/diag/tests/diag.test.ts"

    def setUp(self):
        super().setUp()
        self.outside(self.DIAG, "diagnostic\n")
        self.outside("travail/diag/tests/aide.ts", "aide\n")

    def outside(self, rel, text):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def test_un_fichier_hors_du_plugin_est_copie_dans_tests_et_lance(self):
        before = self.state()
        [(title, files)] = self.single([self.DIAG], None)
        self.assertIn(self.DIAG, title)
        self.assertEqual(files["tests/diag.test.ts"], "diagnostic\n")
        self.assertNotIn("tests/essai.test.ts", files)
        self.assertNotIn("tests/aide.ts", files)
        self.assertEqual(files["hooks/model.ts"], "v3\n")
        self.assertEqual(self.state(), before)

    def test_avec_contre_aussi(self):
        [(title, files)] = self.single([self.DIAG, "tests/essai.test.ts"], "v1")
        self.assertIn("hooks à v1", title)
        self.assertEqual(files["hooks/model.ts"], "v1\n")
        self.assertEqual(files["tests/diag.test.ts"], "diagnostic\n")
        self.assertEqual(files["tests/essai.test.ts"], "test de l'arbre\n")

    def test_les_deux_modes_le_relancent_comme_un_test_du_plugin(self):
        self.outside(self.DIAG, f"// {check.BOTH_STORAGES}\n")
        seen = self.single([self.DIAG], None)
        self.assertEqual(len(seen), 2)
        self.assertIn("stockage $.store", seen[1][0])
        self.assertIn("tests/diag.test.ts", seen[1][1])

    def test_les_formes_refusees_disent_pourquoi(self):
        self.outside("travail/diag/tests/essai.test.ts", "même nom\n")
        self.outside("travail/diag/tests/lecture.test.mjs", "// node\n")
        dehors = Path(tempfile.mkdtemp(prefix="test-dehors-")).resolve()
        self.addCleanup(shutil.rmtree, dehors, True)
        (dehors / "loin.test.ts").write_text("loin\n", encoding="utf-8")
        before = self.state()
        for name, why in (("travail/diag/tests/essai.test.ts", "existe déjà"),
                          ("travail/diag/tests/lecture.test.mjs", ".test.mjs hors du plugin"),
                          (str(dehors / "loin.test.ts"), "hors du dépôt")):
            with self.subTest(name=name), self.assertRaises(check.Failed) as caught:
                self.single([name], None)
            self.assertIn(why, str(caught.exception))
        self.assertEqual(self.state(), before)

    def test_deux_fichiers_hors_du_plugin_au_meme_nom_sont_refuses(self):
        self.outside("travail/autre/tests/diag.test.ts", "autre\n")
        with self.assertRaises(check.Failed) as caught:
            self.single([self.DIAG, "travail/autre/tests/diag.test.ts"], None)
        self.assertIn("porte déjà le nom diag.test.ts", str(caught.exception))
        # Le même fichier nommé deux fois tourne une fois.
        [(title, files)] = self.single([self.DIAG, self.DIAG], None)
        self.assertEqual(title.count(self.DIAG), 1)

    @unittest.skipIf(os.name == "nt", "liens symboliques : mode développeur requis sous Windows")
    def test_un_lien_symbolique_est_refuse(self):
        (self.repo / "travail" / "diag" / "tests" / "lien.test.ts").symlink_to(self.repo / self.DIAG)
        (self.plugin / "tests" / "lien.test.ts").symlink_to(self.repo / self.DIAG)
        for name in ("travail/diag/tests/lien.test.ts", "tests/lien.test.ts", "plugins/essai/tests/lien.test.ts", "lien.test.ts"):
            with self.subTest(name=name), self.assertRaises(check.Failed) as caught:
                self.single([name], None)
            self.assertIn("lien symbolique", str(caught.exception))


class OptionTest(unittest.TestCase):
    def test_contre_sans_test_est_refuse(self):
        out = subprocess.run([sys.executable, str(Path(check.__file__)), "--contre", "HEAD", "flow-board"],
                             capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(out.returncode, 2)
        self.assertIn("--contre ne va qu'avec --test", out.stderr)


if __name__ == "__main__":
    unittest.main()
