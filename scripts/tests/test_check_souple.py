"""Tests de la souplesse de scripts/check.py : l'arbre « Architecture » signalé à la fin, `--test` à
plusieurs fichiers, les tests touchés du pré-contrôle `--quick` : python3 -m unittest discover -s scripts/tests."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

README = "# essai\n\n## Architecture\n\n```\nessai/\n├── hooks/\n│   └── model.ts   modèle\n└── tests/\n    └── a.test.ts   essai a\n```\n"


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


class QuickCheckTest(unittest.TestCase):
    """`--quick` lance aussi les contrôles statiques et les tests Node du plugin (une fois chacun)."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        # Le chemin réel (`/private/var` sur macOS) : `single_test` résout les fichiers de test.
        self.repo = Path(self.dir.name).resolve()
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        self.plugin = self.repo / "plugins" / "essai"
        for rel in ["tests/a.test.ts", "tests/b.test.mjs", "skills/s/c.test.mjs", "hooks/model.ts"]:
            path = self.plugin / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("// 1\n", encoding="utf-8")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")
        self.saved = (check.REPO, check.run.__defaults__)
        check.REPO = self.repo
        check.run.__defaults__ = (self.repo, None)
        self.steps = []
        for name, value in (("step", lambda title, *args, **kwargs: self.steps.append(title)),
                            ("tool", lambda name: name), ("check_versions", lambda plugin, rev=None: None)):
            patcher = mock.patch.object(check, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        check.DEFERRED.clear()

    def tearDown(self):
        check.REPO, check.run.__defaults__ = self.saved
        check.DEFERRED.clear()
        self.dir.cleanup()

    def test_une_entorse_aux_regles_du_code_fait_echouer_le_pre_controle(self):
        (self.plugin / "hooks" / "model.ts").write_text("export const m = Math.max(...xs)\n", encoding="utf-8")
        with self.assertRaises(check.Failed):
            check.quick_check(self.plugin)

    def test_les_tests_node_du_plugin_tournent_une_seule_fois(self):
        (self.plugin / "tests" / "b.test.mjs").write_text("// 2\n", encoding="utf-8")
        check.quick_check(self.plugin)
        node = [s for s in self.steps if s.startswith("node --test")]
        self.assertEqual(len(node), 1, self.steps)
        self.assertIn("plugins/essai/tests/b.test.mjs", node[0])
        self.assertIn("plugins/essai/skills/s/c.test.mjs", node[0])

    def test_un_fichier_absent_de_l_arbre_est_signale_sans_couper(self):
        (self.plugin / "README.md").write_text(README, encoding="utf-8")
        (self.plugin / "tests" / "nouveau.test.ts").write_text("// n\n", encoding="utf-8")
        check.quick_check(self.plugin)
        self.assertTrue(any("essai/tests/nouveau.test.ts" in d for d in check.DEFERRED), check.DEFERRED)
        self.assertTrue(any(s.startswith("node --test") for s in self.steps), self.steps)
        with self.assertRaises(check.DeferredFailed):
            check.fail_deferred(check.DEFERRED)

    def test_la_sonde_passe_par_ses_propres_controles_statiques(self):
        calls = []
        with mock.patch.dict(check.TOOLS, {"essai": self.plugin}), \
                mock.patch.object(check, "check_export_terms", lambda module: calls.append(module)), \
                mock.patch.object(check, "static_checks", side_effect=AssertionError("static_checks sur un module")):
            check.quick_check(self.plugin)
        self.assertEqual(calls, [self.plugin])


class FixDetachedDocTest(unittest.TestCase):
    """`--fix` retire un bloc `/** */` suivi directement d'un autre : le second, qui documente le code, reste."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.plugin = Path(self.dir.name) / "essai"
        (self.plugin / "hooks").mkdir(parents=True)
        (self.plugin / "tests").mkdir()

    def tearDown(self):
        self.dir.cleanup()

    def write(self, rel, text):
        (self.plugin / rel).write_text(text, encoding="utf-8")

    def read(self, rel):
        return (self.plugin / rel).read_text(encoding="utf-8")

    def test_le_premier_bloc_part_et_le_second_reste(self):
        self.write("hooks/model.ts", "const a = 1\n/** ancien */\n\n/**\n * nouveau\n */\nexport const b = 2\n")
        said = check.fix_detached_docs(self.plugin)
        self.assertEqual(self.read("hooks/model.ts"), "const a = 1\n/**\n * nouveau\n */\nexport const b = 2\n")
        self.assertEqual(len(said), 1)
        self.assertIn("essai/hooks/model.ts:2", said[0])
        self.assertEqual(check.code_rules(self.plugin), [])

    def test_une_suite_de_trois_blocs_ne_garde_que_le_dernier(self):
        self.write("hooks/model.ts", "/** un\n */\n/** deux */\n/** trois */\nexport const b = 2\n")
        check.fix_detached_docs(self.plugin)
        self.assertEqual(self.read("hooks/model.ts"), "/** trois */\nexport const b = 2\n")

    def test_un_bloc_d_une_ligne_suivi_de_code_n_est_jamais_efface(self):
        text = "/** @internal */ export const a = 1\n/*\n * section\n */\n/** doc */\nexport const b = 2\n"
        self.write("hooks/model.ts", text)
        self.assertEqual(check.fix_detached_docs(self.plugin), [])
        self.assertEqual(self.read("hooks/model.ts"), text)
        closing = "/**\n * doc\n */ export const a = 1\n/** b */\nexport const b = 2\n"
        self.write("hooks/model.ts", closing)
        self.assertEqual(check.fix_detached_docs(self.plugin), [])
        self.assertEqual(self.read("hooks/model.ts"), closing)

    def test_un_commentaire_vide_ferme_sur_sa_ligne(self):
        text = "/**/\nconst x = 1\n/** ancien */\n/** doc */\nexport const y = 2\n"
        self.write("hooks/model.ts", text)
        check.fix_detached_docs(self.plugin)
        self.assertIn("const x = 1", self.read("hooks/model.ts"))

    def test_un_bloc_qui_documente_du_code_et_les_tests_restent(self):
        clean = "/** a */\nexport const a = 1\n/** b */\nexport const b = 2\n"
        self.write("hooks/model.ts", clean)
        self.write("tests/a.test.ts", "/** un */\n/** deux */\nconst t = 1\n")
        self.assertEqual(check.fix_detached_docs(self.plugin), [])
        self.assertEqual(self.read("hooks/model.ts"), clean)
        self.assertEqual(self.read("tests/a.test.ts"), "/** un */\n/** deux */\nconst t = 1\n")


class SlippedDocTest(unittest.TestCase):
    """Un bloc `/** */` qui documentait une déclaration dans `HEAD` et qu'un ajout documenté a séparé
    d'elle n'est pas retiré par `--fix` : le message dit de placer l'ajout au-dessus."""

    DOC = "/**\n * Le commentaire de leadEffort,\n * sur plusieurs lignes.\n */\n"

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        self.plugin = self.repo / "plugins" / "essai"
        (self.plugin / "hooks").mkdir(parents=True)
        for args in (["init", "-q", "-b", "main"], ["config", "user.name", "essai"],
                     ["config", "user.email", "essai@localhost"], ["config", "commit.gpgsign", "false"]):
            subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True)
        # `git_show` lit `HEAD` dans `check.REPO` : le dépôt d'essai le remplace.
        self.saved = check.REPO
        check.REPO = self.repo

    def tearDown(self):
        check.REPO = self.saved
        self.dir.cleanup()

    def test_hors_de_git_rien_n_est_garde(self):
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        check.REPO = Path(outside.name)
        self.write("/** ancien */\n/** doc */\nexport const b = 2\n")
        check.fix_detached_docs(self.plugin)
        self.assertEqual(self.read(), "/** doc */\nexport const b = 2\n")

    def commit(self, text):
        (self.plugin / "hooks" / "model.ts").write_text(text, encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=self.repo, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "base"], cwd=self.repo, check=True)

    def write(self, text):
        (self.plugin / "hooks" / "model.ts").write_text(text, encoding="utf-8")

    def read(self):
        return (self.plugin / "hooks" / "model.ts").read_text(encoding="utf-8")

    def test_l_ajout_glisse_ne_retire_rien_et_le_dit(self):
        self.commit("const a = 1\n" + self.DOC + "export function leadEffort() {}\n")
        slipped = "const a = 1\n" + self.DOC + "/** Le nouveau. */\nexport const nouveau = 2\nexport function leadEffort() {}\n"
        self.write(slipped)
        said = check.fix_detached_docs(self.plugin)
        self.assertEqual(self.read(), slipped)
        self.assertEqual(len(said), 1)
        self.assertIn("ajout glissé entre le commentaire de leadEffort et sa déclaration : le placer au-dessus", said[0])
        problems = check.code_rules(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("ajout glissé entre le commentaire de leadEffort", problems[0])
        self.assertNotIn("--fix", problems[0])

    def test_un_bloc_vraiment_detache_part_comme_avant(self):
        self.commit("const a = 1\nexport function leadEffort() {}\n")
        self.write("const a = 1\n/** ancien */\n" + self.DOC + "export function leadEffort() {}\n")
        said = check.fix_detached_docs(self.plugin)
        self.assertEqual(self.read(), "const a = 1\n" + self.DOC + "export function leadEffort() {}\n")
        self.assertIn("bloc /** */ détaché retiré", said[0])

    def test_un_commentaire_reecrit_sous_l_ancien_part_comme_avant(self):
        # Une fusion résolue en gardant les deux côtés : la même déclaration suit les deux blocs.
        self.commit("const a = 1\n/** A */\nexport function f() {}\n")
        self.write("const a = 1\n/** A */\n/** B */\nexport function f() {}\n")
        said = check.fix_detached_docs(self.plugin)
        self.assertEqual(self.read(), "const a = 1\n/** B */\nexport function f() {}\n")
        self.assertIn("bloc /** */ détaché retiré", said[0])

    def test_le_meme_bloc_au_dessus_d_une_autre_declaration_de_head_part_comme_avant(self):
        self.commit("/** @internal */\nexport function a() {}\n")
        self.write("/** @internal */\nexport function a() {}\n/** @internal */\n/** Doc b */\nexport function b() {}\n")
        said = check.fix_detached_docs(self.plugin)
        self.assertEqual(self.read(), "/** @internal */\nexport function a() {}\n/** Doc b */\nexport function b() {}\n")
        self.assertIn("bloc /** */ détaché retiré", said[0])

    def test_un_bloc_repete_reecrit_sous_l_ancien_part_comme_avant(self):
        # Revue du groupe D : le même bloc court documente aussi une déclaration plus bas dans HEAD ; celle qui
        # le suit encore l'avait déjà dans HEAD : un commentaire réécrit, pas un ajout glissé avant b.
        self.commit("/** Interne. */\nexport function a() {}\n/** Interne. */\nexport function b() {}\n")
        self.write("/** Interne. */\n/** Calcule a. */\nexport function a() {}\n/** Interne. */\nexport function b() {}\n")
        said = check.fix_detached_docs(self.plugin)
        self.assertEqual(self.read(), "/** Calcule a. */\nexport function a() {}\n/** Interne. */\nexport function b() {}\n")
        self.assertIn("bloc /** */ détaché retiré", said[0])

    def test_un_fichier_absent_de_head_garde_le_comportement_d_avant(self):
        self.commit("const a = 1\n")
        (self.plugin / "hooks" / "neuf.ts").write_text("/** ancien */\n/** doc */\nexport const b = 2\n", encoding="utf-8")
        said = check.fix_detached_docs(self.plugin)
        self.assertEqual((self.plugin / "hooks" / "neuf.ts").read_text(encoding="utf-8"), "/** doc */\nexport const b = 2\n")
        self.assertIn("bloc /** */ détaché retiré", said[0])


if __name__ == "__main__":
    unittest.main()
