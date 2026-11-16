"""Tests de `check.sh --fix` sur un arbre « Architecture » en conflit de fusion et sur ses doublons
(scripts/check.py, `fix_architecture`), et du signalement des lignes sans commentaire (`static_checks`) :
python3 -m unittest discover -s scripts/tests."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

HEAD = "# essai\n\nIntro.\n\n## Architecture\n\n```\nessai/\n├── hooks/\n"
FOOT = "```\n\n## Suite\n\nFin.\n"
TESTS = "└── tests/\n    └── x.test.ts   essai x\n"


def readme(body, tests=TESTS):
    """Un README dont l'arbre a `body` sous `hooks/` (lignes déjà indentées), puis `tests`."""
    return HEAD + body + tests + FOOT


class Plugin(unittest.TestCase):
    """Un plugin d'essai : `hooks/` porte a.ts, b.ts, c.ts ; `tests/` porte x.test.ts ; le journal gardé."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.plugin = Path(self.dir.name) / "essai"
        (self.plugin / "hooks").mkdir(parents=True)
        (self.plugin / "tests").mkdir()
        for name in ("a.ts", "b.ts", "c.ts"):
            (self.plugin / "hooks" / name).write_text("export const v = 1\n", encoding="utf-8")
        (self.plugin / "tests" / "x.test.ts").write_text("// x\n", encoding="utf-8")
        self.logged = []
        patcher = mock.patch.object(check, "log", lambda *a, **k: self.logged.append(" ".join(map(str, a))))
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.dir.cleanup()

    def write(self, text):
        (self.plugin / "README.md").write_text(text, encoding="utf-8")

    def read(self):
        return (self.plugin / "README.md").read_text(encoding="utf-8")

    def assert_refused(self, text, *said):
        """`--fix` refuse : README inchangé octet pour octet, Failed qui dit chaque élément et la procédure."""
        self.write(text)
        with self.assertRaises(check.Failed) as err:
            check.fix_architecture(self.plugin)
        self.assertEqual(self.read(), text)
        for part in said + ("docs/check-sh.md",):
            self.assertIn(part, str(err.exception))


class ConflictTest(Plugin):
    """Un conflit de fusion dans le bloc de l'arbre se résout par l'union des deux côtés."""

    def test_un_conflit_simple_garde_l_union_des_deux_cotes(self):
        self.write(readme(
            "│   ├── a.ts        module a\n"
            "<<<<<<< HEAD\n"
            "│   └── b.ts        module b\n"
            "=======\n"
            "│   └── c.ts        module c\n"
            ">>>>>>> branche\n"))
        check.fix_architecture(self.plugin)
        self.assertEqual(self.read(), readme(
            "│   ├── a.ts        module a\n"
            "│   ├── b.ts        module b\n"
            "│   └── c.ts        module c\n"))

    def test_un_meme_fichier_ajoute_des_deux_cotes_n_apparait_qu_une_fois(self):
        self.write(readme(
            "│   ├── a.ts        module a\n"
            "<<<<<<< HEAD\n"
            "│   ├── b.ts        module b\n"
            "│   └── c.ts\n"
            "=======\n"
            "│   ├── b.ts  module b\n"
            "│   └── c.ts        module c\n"
            ">>>>>>> branche\n"))
        check.fix_architecture(self.plugin)
        self.assertEqual(self.read(), readme(
            "│   ├── a.ts        module a\n"
            "│   ├── b.ts        module b\n"
            "│   └── c.ts        module c\n"))

    def test_deux_commentaires_differents_refusent_sans_rien_ecrire(self):
        self.assert_refused(readme(
            "│   ├── a.ts        module a\n"
            "<<<<<<< HEAD\n"
            "│   ├── b.ts        module b\n"
            "│   └── c.ts        module c\n"
            "=======\n"
            "│   ├── b.ts        le module b reformulé\n"
            "│   └── c.ts        module c\n"
            ">>>>>>> branche\n"), "hooks/b.ts", "« module b »", "« le module b reformulé »")

    def test_un_conflit_diff3_jette_la_base(self):
        self.write(readme(
            "│   ├── a.ts        module a\n"
            "<<<<<<< HEAD\n"
            "│   └── b.ts        module b\n"
            "||||||| base\n"
            "│   └── a-retire.ts ancien\n"
            "=======\n"
            "│   └── c.ts        module c\n"
            ">>>>>>> branche\n"))
        check.fix_architecture(self.plugin)
        self.assertEqual(self.read(), readme(
            "│   ├── a.ts        module a\n"
            "│   ├── b.ts        module b\n"
            "│   └── c.ts        module c\n"))

    def test_une_liste_non_triee_garde_l_ordre_du_premier_cote_puis_le_second(self):
        self.write(readme(
            "<<<<<<< HEAD\n"
            "│   ├── c.ts        module c\n"
            "│   └── a.ts        module a\n"
            "=======\n"
            "│   ├── c.ts        module c\n"
            "│   └── b.ts        module b\n"
            ">>>>>>> branche\n"))
        check.fix_architecture(self.plugin)
        self.assertEqual(self.read(), readme(
            "│   ├── c.ts        module c\n"
            "│   ├── a.ts        module a\n"
            "│   └── b.ts        module b\n"))

    def test_un_conflit_dans_tests_et_hooks_a_la_fois(self):
        (self.plugin / "tests" / "y.test.ts").write_text("// y\n", encoding="utf-8")
        self.write(readme(
            "<<<<<<< HEAD\n"
            "│   ├── a.ts        module a\n"
            "│   └── b.ts        module b\n"
            "└── tests/\n"
            "    └── x.test.ts   essai x\n"
            "=======\n"
            "│   ├── a.ts        module a\n"
            "│   └── c.ts        module c\n"
            "└── tests/\n"
            "    └── y.test.ts   essai y\n"
            ">>>>>>> branche\n", tests=""))
        check.fix_architecture(self.plugin)
        self.assertEqual(self.read(), readme(
            "│   ├── a.ts        module a\n"
            "│   ├── b.ts        module b\n"
            "│   └── c.ts        module c\n",
            tests="└── tests/\n    ├── x.test.ts   essai x\n    └── y.test.ts   essai y\n"))

    def test_une_ligne_hors_des_listes_d_un_seul_cote_refuse(self):
        text = (HEAD.replace("├── hooks/\n", "<<<<<<< HEAD\n├── commands/a.md  commande a\n=======\n>>>>>>> branche\n├── hooks/\n")
                + "│   ├── a.ts        module a\n│   ├── b.ts        module b\n│   └── c.ts        module c\n" + TESTS + FOOT)
        self.assert_refused(text, "« ├── commands/a.md  commande a »")

    def test_une_liste_d_un_seul_cote_refuse_sans_citer_une_ligne_qui_n_existe_pas(self):
        text = readme(
            "│   ├── a.ts        module a\n"
            "│   ├── b.ts        module b\n"
            "<<<<<<< HEAD\n"
            "│   └── c.ts        module c\n"
            "└── tests/\n"
            "    └── x.test.ts   essai x\n"
            "=======\n"
            "│   └── c.ts        module c\n"
            ">>>>>>> branche\n", tests="")
        self.write(text)
        with self.assertRaises(check.Failed) as err:
            check.fix_architecture(self.plugin)
        self.assertEqual(self.read(), text)
        self.assertIn("« └── tests/ »", str(err.exception))
        self.assertNotIn("« tests »", str(err.exception))
        self.assertNotIn("« hooks »", str(err.exception))

    def test_des_marques_mal_appariees_refusent(self):
        self.assert_refused(readme(
            "│   ├── a.ts        module a\n"
            "<<<<<<< HEAD\n"
            "│   └── b.ts        module b\n"
            ">>>>>>> branche\n"), ">>>>>>>")
        self.assert_refused(readme(
            "│   ├── a.ts        module a\n"
            "<<<<<<< HEAD\n"
            "│   └── b.ts        module b\n"
            "=======\n"
            "│   └── c.ts        module c\n"), "sans fin")

    def test_un_conflit_hors_du_bloc_laisse_le_reste_et_reecrit_le_bloc(self):
        text = readme("│   ├── a.ts        module a\n│   └── b.ts        module b\n").replace(
            "Fin.\n", "<<<<<<< HEAD\nFin.\n=======\nFin autre.\n>>>>>>> branche\n")
        self.write(text)
        check.fix_architecture(self.plugin)
        self.assertEqual(self.read(), text.replace("│   └── b.ts        module b\n",
                                                   "│   ├── b.ts        module b\n│   └── c.ts\n"))


class DuplicateTest(Plugin):
    """Les lignes en double d'une liste partent, même sans conflit."""

    def test_un_doublon_garde_la_premiere_ligne_qui_a_un_commentaire(self):
        self.write(readme(
            "│   ├── a.ts\n"
            "│   ├── b.ts        module b\n"
            "│   ├── a.ts        module a\n"
            "│   ├── c.ts        module c\n"
            "│   └── a.ts        module a\n"))
        check.fix_architecture(self.plugin)
        self.assertEqual(self.read(), readme(
            "│   ├── b.ts        module b\n"
            "│   ├── a.ts        module a\n"
            "│   └── c.ts        module c\n"))

    def test_un_doublon_sans_commentaire_garde_la_premiere(self):
        self.write(readme(
            "│   ├── a.ts        module a\n"
            "│   ├── b.ts        module b\n"
            "│   └── c.ts        module c\n",
            tests="└── tests/\n    ├── x.test.ts\n    └── x.test.ts\n"))
        check.fix_architecture(self.plugin)
        self.assertIn("└── tests/\n    └── x.test.ts\n```", self.read())

    def test_un_bloc_de_doublons_apres_une_ligne_vide_part_avec_elle(self):
        (self.plugin / "tests" / "y.test.ts").write_text("// y\n", encoding="utf-8")
        self.write(readme(
            "│   ├── a.ts        module a\n"
            "│   ├── b.ts        module b\n"
            "│   └── c.ts        module c\n",
            tests="└── tests/\n    ├── x.test.ts   essai x\n    └── y.test.ts   essai y\n\n"
                  "    ├── x.test.ts\n    └── y.test.ts\n"))
        check.fix_architecture(self.plugin)
        self.assertIn("└── tests/\n    ├── x.test.ts   essai x\n    └── y.test.ts   essai y\n```", self.read())

    def test_une_note_indentee_apres_une_ligne_vide_reste_hors_de_la_liste(self):
        tests = "└── tests/\n    └── x.test.ts   essai x\n\n    Note : les fichiers de tests/ se lancent par check.sh.\n"
        text = readme("│   ├── a.ts        module a\n│   ├── b.ts        module b\n│   └── c.ts        module c\n", tests=tests)
        self.write(text)
        check.fix_architecture(self.plugin)
        self.assertEqual(self.read(), text)

    def test_un_doublon_a_deux_commentaires_differents_refuse(self):
        self.assert_refused(readme(
            "│   ├── a.ts        module a\n"
            "│   ├── b.ts        module b\n"
            "│   ├── c.ts        module c\n"
            "│   └── a.ts        autre a\n"), "hooks/a.ts", "« module a »", "« autre a »")


class BareLineTest(Plugin):
    """`static_checks` signale une ligne de `hooks/` sans commentaire, et une ligne de `tests/` sans
    commentaire que le README à HEAD n'avait pas ; les lignes déjà là restent permises."""

    def deferred(self, at_head):
        with mock.patch.object(check, "git_show", lambda root, spec: at_head):
            return check.static_checks(self.plugin)

    def test_une_ligne_de_hooks_sans_commentaire_est_signalee(self):
        text = readme("│   ├── a.ts        module a\n│   ├── b.ts\n│   └── c.ts        module c\n")
        self.write(text)
        deferred = self.deferred(text)
        self.assertEqual(len(deferred), 1)
        self.assertIn("essai/hooks/b.ts", deferred[0])
        self.assertIn("sans commentaire", deferred[0])

    def test_une_ligne_de_tests_sans_commentaire_deja_a_head_passe(self):
        text = readme("│   ├── a.ts        module a\n│   ├── b.ts        module b\n│   └── c.ts        module c\n",
                      tests="└── tests/\n    └── x.test.ts\n")
        self.write(text)
        self.assertEqual(self.deferred(text), [])

    def test_une_ligne_de_tests_sans_commentaire_neuve_est_signalee(self):
        at_head = readme("│   ├── a.ts        module a\n│   ├── b.ts        module b\n│   └── c.ts        module c\n",
                         tests="└── tests/\n    └── x.test.ts\n")
        (self.plugin / "tests" / "y.test.ts").write_text("// y\n", encoding="utf-8")
        self.write(at_head.replace("    └── x.test.ts\n", "    ├── x.test.ts\n    └── y.test.ts\n"))
        deferred = self.deferred(at_head)
        self.assertEqual(len(deferred), 1)
        self.assertIn("essai/tests/y.test.ts", deferred[0])

    def test_un_commentaire_de_tests_perdu_est_signale(self):
        at_head = readme("│   ├── a.ts        module a\n│   ├── b.ts        module b\n│   └── c.ts        module c\n")
        self.write(at_head.replace("    └── x.test.ts   essai x\n", "    └── x.test.ts\n"))
        deferred = self.deferred(at_head)
        self.assertEqual(len(deferred), 1)
        self.assertIn("essai/tests/x.test.ts", deferred[0])

    def test_sans_readme_a_head_toute_ligne_de_tests_nue_est_neuve(self):
        self.write(readme("│   ├── a.ts        module a\n│   ├── b.ts        module b\n│   └── c.ts        module c\n",
                          tests="└── tests/\n    └── x.test.ts\n"))
        self.assertEqual(len(self.deferred(None)), 1)


if __name__ == "__main__":
    unittest.main()
