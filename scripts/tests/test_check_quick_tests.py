"""Tests du choix des fichiers de test du pré-contrôle rapide (scripts/check.py, named_tests et
quick_check) : les fichiers de test du moteur qui nomment une déclaration exportée de `hooks/` changée
face à `HEAD` partent avec les fichiers de test touchés. python3 -m unittest discover -s scripts/tests."""

import io
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

HOOKS = """import { x } from "./x";

export function applySkill(a: number) {
  return a + 1;
}

function helper() {
  return 2;
}

export const detachOnLoad = () => {
  return 3;
};

export async function closeRun() {
  return 4;
}
"""


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class NamedTestsTest(unittest.TestCase):
    """Un dépôt d'essai : un plugin dont `hooks/mod.ts` porte trois déclarations exportées et une privée,
    et des fichiers de test qui en nomment chacun une."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        self.plugin = self.repo / "plugins" / "essai"
        self.write("hooks/mod.ts", HOOKS)
        self.write("tests/apply.test.ts", 'import { applySkill } from "../hooks/mod";\napplySkill(1);\n')
        self.write("tests/detach.test.tsx", "detachOnLoad();\n")
        self.write("tests/prefixe.test.ts", "applySkillTwice(); $closeRun();\n")
        self.write("tests/close.test.ts", "closeRun();\n")
        self.write("tests/lit-source.test.mjs", "applySkill\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")
        # Les commandes git de check.py tournent dans REPO, valeur par défaut de `run` : le dépôt d'essai la remplace.
        self.saved = (check.REPO, check.run.__defaults__)
        check.REPO = self.repo
        check.run.__defaults__ = (self.repo, None)

    def tearDown(self):
        check.REPO, check.run.__defaults__ = self.saved
        self.dir.cleanup()

    def write(self, rel, text):
        path = self.plugin / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def edit(self, old, new):
        path = self.plugin / "hooks" / "mod.ts"
        path.write_text(path.read_text(encoding="utf-8").replace(old, new), encoding="utf-8")

    def test_le_corps_change_choisit_les_tests_qui_nomment_la_declaration(self):
        self.edit("return a + 1;", "return a + 2;")
        self.assertEqual(check.named_tests(self.plugin), {"tests/apply.test.ts": ["applySkill"]})

    def test_rien_ne_change_sans_changement_dans_hooks(self):
        self.write("tests/close.test.ts", "closeRun(); closeRun();\n")
        self.assertEqual(check.named_tests(self.plugin), {})

    def test_une_declaration_privee_changee_ne_compte_pas_pour_l_export_d_avant(self):
        self.edit("return 2;", "return 5;")
        self.assertEqual(check.named_tests(self.plugin), {})

    def test_une_ligne_retiree_compte_pour_sa_declaration(self):
        self.edit("  return 3;\n", "")
        self.assertEqual(check.named_tests(self.plugin), {"tests/detach.test.tsx": ["detachOnLoad"]})

    def test_un_bloc_sur_deux_declarations_les_compte_toutes(self):
        self.edit("  return 3;\n};\n\nexport async function closeRun() {\n  return 4;",
                  "  return 6;\n} ;\n \nexport async function closeRun() { \n  return 7;")
        self.assertEqual(check.named_tests(self.plugin),
                         {"tests/close.test.ts": ["closeRun"], "tests/detach.test.tsx": ["detachOnLoad"]})

    def test_un_changement_indexe_compte(self):
        self.edit("return 4;", "return 8;")
        git(self.repo, "add", ".")
        self.assertEqual(check.named_tests(self.plugin), {"tests/close.test.ts": ["closeRun"]})

    def test_un_nom_qui_n_est_qu_un_prefixe_ou_un_suffixe_ne_choisit_pas(self):
        self.edit("return a + 1;", "return a + 2;")
        self.edit("return 4;", "return 8;")
        found = check.named_tests(self.plugin)
        self.assertNotIn("tests/prefixe.test.ts", found)
        self.assertNotIn("tests/lit-source.test.mjs", found)
        self.assertEqual(found, {"tests/apply.test.ts": ["applySkill"], "tests/close.test.ts": ["closeRun"]})

    def test_un_fichier_de_hooks_nouveau_non_suivi_compte_toutes_ses_declarations(self):
        self.write("hooks/neuf.ts", "export function applySkill() {}\nexport class Neuve {}\n")
        self.write("tests/neuve.test.ts", "new Neuve();\n")
        self.assertEqual(check.named_tests(self.plugin),
                         {"tests/apply.test.ts": ["applySkill"], "tests/neuve.test.ts": ["Neuve"]})

    def test_un_fichier_qui_nomme_deux_declarations_les_cite_toutes(self):
        self.write("tests/deux.test.ts", "applySkill(); closeRun();\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "deux")
        self.edit("return a + 1;", "return a + 2;")
        self.edit("return 4;", "return 8;")
        self.assertEqual(check.named_tests(self.plugin)["tests/deux.test.ts"], ["applySkill", "closeRun"])

    def test_un_plugin_sans_hooks_ne_choisit_rien(self):
        bare = self.repo / "plugins" / "nu"
        (bare / "tests").mkdir(parents=True)
        self.assertEqual(check.named_tests(bare), {})

    def quick(self):
        """`quick_check` avec ses étapes lourdes simulées : les fichiers passés à `single_test` et sa sortie."""
        calls = []
        out = io.StringIO()
        with mock.patch.object(check, "static_checks", lambda plugin: []), \
                mock.patch.object(check, "typecheck", lambda plugin: None), \
                mock.patch.object(check, "node_tests", lambda plugin: None), \
                mock.patch.object(check, "single_test", lambda plugin, names: calls.append(list(names))), \
                redirect_stdout(out):
            check.quick_check(self.plugin)
        return calls, out.getvalue()

    def test_quick_check_lance_les_tests_touches_et_choisis_en_un_seul_lancement(self):
        self.edit("return a + 1;", "return a + 2;")
        self.write("tests/close.test.ts", "closeRun(); closeRun();\n")
        calls, out = self.quick()
        self.assertEqual(calls, [["tests/apply.test.ts", "tests/close.test.ts"]])
        self.assertIn("→ tests qui nomment une fonction modifiée : apply.test.ts (applySkill)", out)

    def test_quick_check_sans_changement_dans_hooks_garde_son_message(self):
        calls, out = self.quick()
        self.assertEqual(calls, [])
        self.assertIn("→ aucun fichier de test du moteur touché face à HEAD", out)
        self.assertNotIn("nomment une fonction", out)


if __name__ == "__main__":
    unittest.main()
