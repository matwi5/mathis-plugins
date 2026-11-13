"""Tests du relevé « à relire avant commit » du pré-contrôle rapide (scripts/check.py, reread_list et
quick_check) : pour chaque déclaration de `hooks/` dont le corps a changé, son commentaire de tête et
les lignes du README qui la nomment, quand le diff ne les touche pas. python3 -m unittest discover -s scripts/tests."""

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

/** Ajoute un à la valeur. */
export function applySkill(a: number) {
  return a + 1;
}

// Une aide privée,
// sur deux lignes.
function helper() {
  return 2;
}

export const nu = () => {
  return 3;
};
"""

README = """# Essai

`applySkill` ajoute un.
La fonction helper aide.
applySkillTwice n'est pas nommée.
"""


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class RereadListTest(unittest.TestCase):
    """Un dépôt d'essai : un plugin dont `hooks/mod.ts` porte une déclaration exportée sous un bloc
    `/** */`, une privée sous des lignes `//`, une sans commentaire, et un README qui en nomme deux."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        self.plugin = self.repo / "plugins" / "essai"
        self.write("hooks/mod.ts", HOOKS)
        self.write("README.md", README)
        self.write("tests/apply.test.ts", "applySkill(1);\n")
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

    def edit(self, rel, old, new):
        path = self.plugin / rel
        path.write_text(path.read_text(encoding="utf-8").replace(old, new), encoding="utf-8")

    def quick(self):
        """`quick_check` avec ses étapes lourdes simulées : sa sortie."""
        out = io.StringIO()
        with mock.patch.object(check, "static_checks", lambda plugin: []), \
                mock.patch.object(check, "typecheck", lambda plugin: None), \
                mock.patch.object(check, "node_tests", lambda plugin: None), \
                mock.patch.object(check, "single_test", lambda plugin, names: None), \
                redirect_stdout(out):
            check.quick_check(self.plugin)
        return out.getvalue()

    def test_un_corps_change_sous_un_commentaire_reste_tel_quel_le_releve(self):
        self.edit("hooks/mod.ts", "return a + 1;", "return a + 2;")
        self.assertEqual(check.reread_list(self.plugin),
                         ["hooks/mod.ts:3 applySkill : commentaire de tête", "README.md:3 : nomme applySkill"])

    def test_un_commentaire_change_n_est_pas_releve(self):
        self.edit("hooks/mod.ts", "/** Ajoute un à la valeur. */", "/** Ajoute deux à la valeur. */")
        self.edit("hooks/mod.ts", "return a + 1;", "return a + 2;")
        self.assertEqual(check.reread_list(self.plugin), ["README.md:3 : nomme applySkill"])

    def test_une_ligne_du_readme_changee_n_est_pas_relevee(self):
        self.edit("hooks/mod.ts", "return a + 1;", "return a + 2;")
        self.edit("README.md", "`applySkill` ajoute un.", "`applySkill` ajoute deux.")
        self.assertEqual(check.reread_list(self.plugin), ["hooks/mod.ts:3 applySkill : commentaire de tête"])

    def test_une_declaration_non_exportee_sous_des_lignes_de_commentaire(self):
        self.edit("hooks/mod.ts", "return 2;", "return 5;")
        self.assertEqual(check.reread_list(self.plugin),
                         ["hooks/mod.ts:8 helper : commentaire de tête", "README.md:4 : nomme helper"])

    def test_une_declaration_sans_commentaire_n_a_pas_de_ligne_de_commentaire(self):
        self.edit("hooks/mod.ts", "return 3;", "return 6;")
        self.assertEqual(check.reread_list(self.plugin), [])

    def test_un_commentaire_qui_n_est_pas_un_bloc_doc_n_est_pas_pris_pour_celui_d_en_haut(self):
        for above in ("/* simple */", "/*\n * bloc simple\n */", "foo(); /* n */"):
            with self.subTest(above=above):
                lines = f"/** Doc A. */\nexport const a = 1;\n\n{above}\nexport function b() {{}}".split("\n")
                self.assertIsNone(check.head_comment(lines, len(lines)))

    def test_un_bloc_doc_sur_plusieurs_lignes_est_pris_en_entier(self):
        lines = "const z = 0;\n/**\n * Doc B.\n */\nexport function b() {}".split("\n")
        self.assertEqual(check.head_comment(lines, 5), (2, 4))

    def test_un_module_non_suivi_n_est_pas_releve(self):
        self.write("hooks/neuf.ts", "/** Neuve. */\nexport function applySkill() {}\n")
        self.assertEqual(check.reread_list(self.plugin), [])

    def test_sans_changement_rien_n_est_releve(self):
        self.assertEqual(check.reread_list(self.plugin), [])
        self.assertNotIn("à relire", self.quick())

    def test_quick_check_imprime_le_releve_apres_ses_tests(self):
        self.edit("hooks/mod.ts", "return a + 1;", "return a + 2;")
        out = self.quick()
        self.assertIn("→ à relire avant commit :\n  hooks/mod.ts:3 applySkill : commentaire de tête\n"
                      "  README.md:3 : nomme applySkill\n", out)
        self.assertLess(out.index("nomment une fonction modifiée"), out.index("à relire avant commit"))

    def test_le_releve_s_arrete_a_40_elements(self):
        self.write("README.md", README + "".join(f"applySkill, ligne {n}.\n" for n in range(45)))
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "readme long")
        self.edit("hooks/mod.ts", "return a + 1;", "return a + 2;")
        lines = [l for l in self.quick().splitlines() if l.startswith("  ")]
        self.assertEqual(len(lines), 41)
        self.assertEqual(lines[-1], "  … et 7 de plus")

    def test_le_releve_ne_fait_jamais_echouer(self):
        self.edit("hooks/mod.ts", "return a + 1;", "return a + 2;")
        with mock.patch.object(check, "reread_list", lambda plugin: None):
            self.quick()
        self.assertEqual(check.DEFERRED, [])

    def test_un_commentaire_seul_change_ne_fait_pas_relever_la_declaration_d_avant(self):
        self.edit("hooks/mod.ts", "// Une aide privée,", "// Une aide privée et courte,")
        self.assertEqual(check.reread_list(self.plugin), [])

    def test_un_module_nouveau_deja_indexe_n_est_pas_releve(self):
        self.write("hooks/neuf.ts", "/** Neuve. */\nexport function applySkill() {}\n")
        git(self.repo, "add", ".")
        self.assertEqual(check.reread_list(self.plugin), [])

    def test_le_releve_s_imprime_aussi_quand_un_test_echoue(self):
        self.edit("hooks/mod.ts", "return a + 1;", "return a + 2;")
        out = io.StringIO()

        def fails(plugin, names):
            raise check.Failed("test rouge")

        with mock.patch.object(check, "static_checks", lambda plugin: []), \
                mock.patch.object(check, "typecheck", lambda plugin: None), \
                mock.patch.object(check, "node_tests", lambda plugin: None), \
                mock.patch.object(check, "single_test", fails), \
                redirect_stdout(out):
            with self.assertRaises(check.Failed):
                check.quick_check(self.plugin)
        self.assertIn("→ à relire avant commit :", out.getvalue())

    def test_le_releve_ne_part_pas_dans_deferred(self):
        self.edit("hooks/mod.ts", "return a + 1;", "return a + 2;")
        self.quick()
        self.assertEqual(check.DEFERRED, [])


if __name__ == "__main__":
    unittest.main()
