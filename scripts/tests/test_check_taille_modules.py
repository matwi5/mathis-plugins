"""Tests du contrôle de taille des modules de `hooks/` (scripts/check.py) : le moteur ne lit pas un module
de plus de 1 048 576 octets (« is over 1048576 bytes and was not read », et le mod ne se charge plus) ;
`check.sh --quick` et le pre-commit échouent au-delà, et avertissent, sans échouer, sous 16 384 octets
de marge (lignes « AVERTISSEMENT : … » après le verdict d'une réussite, juste avant la ligne « ÉCHEC : … »
d'un échec, qui n'est suivie que du relevé « à relire avant commit » de `--quick` quand il y en a un).
python3 -m unittest discover -s scripts/tests."""

import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

CEILING = 1_048_576
MARGIN = 16_384


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def sized(n, fill="a"):
    """Un module de `n` octets exactement (un commentaire de remplissage) ; `fill` d'un ou deux octets en UTF-8."""
    head = "const a = 1\n// "
    width = len(fill.encode("utf-8"))
    body = n - len(head.encode("utf-8")) - 1
    text = head + fill * (body // width) + "a" * (body % width) + "\n"
    assert len(text.encode("utf-8")) == n
    return text


class ModuleSizesTest(unittest.TestCase):
    """`module_sizes` mesure chaque fichier de code de `hooks/` en octets, face au plafond du moteur."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.plugin = Path(self.dir.name) / "essai"
        (self.plugin / "hooks").mkdir(parents=True)
        (self.plugin / "tests").mkdir()

    def tearDown(self):
        self.dir.cleanup()

    def module(self, rel, text):
        path = self.plugin / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def test_le_plafond_tout_juste_passe_un_octet_de_plus_echoue(self):
        self.module("hooks/register.tsx", sized(CEILING))
        over, _ = check.module_sizes(self.plugin)
        self.assertEqual(over, [])
        self.module("hooks/register.tsx", sized(CEILING + 1))
        over, _ = check.module_sizes(self.plugin)
        self.assertEqual(len(over), 1)
        self.assertIn("essai/hooks/register.tsx", over[0])
        self.assertIn("1048577 octets", over[0])
        self.assertIn("1 au-delà", over[0])

    def test_16384_octets_de_marge_n_avertit_pas_16383_avertit(self):
        self.module("hooks/model.ts", sized(CEILING - MARGIN))
        self.assertEqual(check.module_sizes(self.plugin), ([], []))
        self.module("hooks/model.ts", sized(CEILING - MARGIN + 1))
        over, near = check.module_sizes(self.plugin)
        self.assertEqual(over, [])
        self.assertEqual(len(near), 1)
        self.assertIn("essai/hooks/model.ts", near[0])
        self.assertIn("16383 octets de marge", near[0])

    def test_la_taille_se_mesure_en_octets_pas_en_caracteres(self):
        # « é » fait deux octets : le fichier dépasse en octets, pas en caractères.
        text = sized(CEILING + 2, fill="é")
        self.assertLess(len(text), CEILING)
        self.module("hooks/view.tsx", text)
        over, _ = check.module_sizes(self.plugin)
        self.assertEqual(len(over), 1)
        self.assertIn("essai/hooks/view.tsx", over[0])

    def test_seuls_les_fichiers_de_code_de_hooks_comptent(self):
        self.module("tests/gros.test.ts", sized(CEILING + 10))
        self.module("hooks/notes.md", sized(CEILING + 10))
        self.module("README.md", sized(CEILING + 10))
        self.module("hooks/sous/module.ts", sized(CEILING + 10))
        over, near = check.module_sizes(self.plugin)
        self.assertEqual([o.split(" : ")[0] for o in over], ["essai/hooks/sous/module.ts"])
        self.assertEqual(near, [])

    def test_le_controle_echoue_au_dela_et_avertit_sous_la_marge(self):
        self.module("hooks/a.ts", sized(CEILING - 100))
        with mock.patch.object(check, "WARNINGS", []) as warnings, redirect_stdout(io.StringIO()):
            check.check_module_sizes(self.plugin)
            self.assertEqual(len(warnings), 1)
            self.assertIn("essai/hooks/a.ts", warnings[0])
        self.module("hooks/b.ts", sized(CEILING + 5))
        with mock.patch.object(check, "WARNINGS", []), redirect_stdout(io.StringIO()):
            with self.assertRaises(check.Failed) as err:
                check.check_module_sizes(self.plugin)
        self.assertIn("essai/hooks/b.ts", str(err.exception))

    def test_les_controles_statiques_le_lancent(self):
        self.module("hooks/a.ts", sized(CEILING + 5))
        with mock.patch.object(check, "WARNINGS", []), redirect_stdout(io.StringIO()):
            with self.assertRaises(check.Failed) as err:
                check.static_checks(self.plugin)
        self.assertIn("plafond", str(err.exception))


class WarningsTest(unittest.TestCase):
    """Le canal d'avertissement : des lignes « AVERTISSEMENT : … » après le verdict d'une réussite, avant la ligne
    « ÉCHEC : … » d'un échec, sans changer le code de sortie."""

    def run_main(self, argv, quick):
        out = io.StringIO()
        with mock.patch.object(check, "WARNINGS", []), mock.patch.object(sys, "argv", argv), \
                mock.patch.object(check, "quick_check", side_effect=quick), \
                mock.patch.object(check, "check_repo_rules"), mock.patch.object(check, "repo_rules_problems", return_value=[]), \
                redirect_stdout(out):
            try:
                check.main()
                code = 0
            except SystemExit as exit_:
                code = exit_.code
        return code, out.getvalue().rstrip("\n").split("\n")

    def test_un_avertissement_s_imprime_apres_le_verdict_sans_echec(self):
        code, lines = self.run_main(["check.py", "--quick", "flow-board"], lambda plugin: check.warn("hooks/x.ts : marge courte"))
        self.assertEqual(code, 0)
        self.assertTrue(lines[-3].startswith("Pré-contrôle passé"), lines[-3:])
        self.assertEqual(lines[-1], "AVERTISSEMENT : hooks/x.ts : marge courte")

    def test_sur_un_echec_les_avertissements_precedent_la_ligne_echec(self):
        # Sans relevé « à relire avant commit » (quick_check simulé), la ligne « ÉCHEC » est la dernière.
        def fails(plugin):
            check.warn("hooks/x.ts : marge courte")
            raise check.Failed("autre chose")
        code, lines = self.run_main(["check.py", "--quick", "flow-board"], fails)
        self.assertEqual(code, 1)
        self.assertEqual(lines[-1], "ÉCHEC : autre chose")
        self.assertIn("AVERTISSEMENT : hooks/x.ts : marge courte", lines)


class StagedSizeTest(unittest.TestCase):
    """Le pre-commit mesure la version indexée du module, pas celle de l'arbre de travail."""

    MODULE = "plugins/flow-board/hooks/register.tsx"

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        self.write("plugins/flow-board/.claude-plugin/plugin.json", json.dumps({"name": "flow-board", "version": "0.1.0"}))
        self.write(self.MODULE, "export const register = () => {}\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")
        self.saved = (check.REPO, check.PLUGINS, check.run.__defaults__)
        check.REPO = self.repo
        check.PLUGINS = self.repo / "plugins"
        check.run.__defaults__ = (self.repo, None)
        light = mock.Mock()
        self.patches = [mock.patch.object(check, name, light) for name in
                        ("validate", "check_code", "staged_types", "typecheck", "plugin_tests", "suite_passed_already", "index_suite")]
        self.patches.append(mock.patch.object(check, "tool", lambda name: name))
        self.patches.append(mock.patch.object(check, "passed_already", lambda plugin: False))
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        check.REPO, check.PLUGINS, check.run.__defaults__ = self.saved
        self.dir.cleanup()

    def write(self, rel, text):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def staged(self):
        with mock.patch.object(check, "WARNINGS", []) as warnings, redirect_stdout(io.StringIO()):
            try:
                check.staged()
            except check.Failed as err:
                return str(err), list(warnings)
            return None, list(warnings)

    def test_un_module_indexe_trop_gros_est_refuse_meme_si_l_arbre_est_petit(self):
        self.write(self.MODULE, sized(CEILING + 1))
        git(self.repo, "add", self.MODULE)
        self.write(self.MODULE, "export const register = () => {}\n")
        failure, _ = self.staged()
        self.assertIsNotNone(failure)
        self.assertIn("flow-board/hooks/register.tsx", failure)

    def test_un_module_indexe_petit_passe_meme_si_l_arbre_est_trop_gros(self):
        self.write(self.MODULE, "export const register = () => { return 1 }\n")
        git(self.repo, "add", self.MODULE)
        self.write(self.MODULE, sized(CEILING + 1))
        failure, warnings = self.staged()
        self.assertIsNone(failure)
        self.assertEqual(warnings, [])

    def test_un_module_indexe_proche_du_plafond_avertit_sans_refuser(self):
        self.write(self.MODULE, sized(CEILING - 1937))
        git(self.repo, "add", self.MODULE)
        failure, warnings = self.staged()
        self.assertIsNone(failure)
        self.assertEqual(len(warnings), 1)
        self.assertIn("flow-board/hooks/register.tsx", warnings[0])


if __name__ == "__main__":
    unittest.main()
