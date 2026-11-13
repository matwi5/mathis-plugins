"""Tests du choix des tests qui épinglent un texte retiré de `hooks/` (scripts/check.py, pinned_tests
et quick_check) : un test du moteur qui recopie une phrase que le diff retire part avec les tests
touchés, même s'il ne nomme aucune fonction changée. python3 -m unittest discover -s scripts/tests."""

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

PHRASE = "Le worker relit le fichier de décisions avant chaque ticket du groupe"
HOOKS = f"""const court = "trop court";

const consigne = "{PHRASE}";

const autre = "Une autre consigne assez longue pour compter, gardée telle quelle";
"""


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class PinnedTestsTest(unittest.TestCase):
    """Un dépôt d'essai : un plugin dont `hooks/mod.ts` porte une consigne, et un test du moteur qui
    l'épingle sans nommer aucune déclaration."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name)
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        self.plugin = self.repo / "plugins" / "essai"
        self.write("hooks/mod.ts", HOOKS)
        self.write("tests/consigne.test.ts", f'expect(texte).toContain("{PHRASE}");\n')
        self.write("tests/court.test.ts", 'expect(texte).toContain("trop court");\n')
        self.write("tests/autre.test.tsx", "expect(texte).toContain(\"Une autre consigne assez longue\");\n")
        self.write("tests/lit-source.test.mjs", f'"{PHRASE}"\n')
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

    def test_une_phrase_changee_choisit_le_test_qui_l_epingle(self):
        self.edit("avant chaque ticket", "au début de chaque ticket")
        found = check.pinned_tests(self.plugin)
        self.assertEqual(list(found), ["tests/consigne.test.ts"])
        self.assertIn("Le worker relit le fichier de décisions", found["tests/consigne.test.ts"])

    def test_une_ligne_retiree_courte_ne_compte_pas(self):
        self.edit('"trop court"', '"bref"')
        self.assertEqual(check.pinned_tests(self.plugin), {})

    def test_une_ligne_deplacee_ne_compte_pas(self):
        self.edit(f'const consigne = "{PHRASE}";\n\n', "")
        self.edit('const court = "trop court";\n', f'const court = "trop court";\nconst consigne = "{PHRASE}";\n')
        self.assertEqual(check.pinned_tests(self.plugin), {})

    def test_un_changement_indexe_compte(self):
        self.edit("avant chaque ticket", "au début de chaque ticket")
        git(self.repo, "add", ".")
        self.assertEqual(list(check.pinned_tests(self.plugin)), ["tests/consigne.test.ts"])

    def test_les_echappements_et_les_blancs_se_normalisent(self):
        self.write("tests/consigne.test.ts", 'expect(texte).toContain(\n  "Le worker relit le fichier   de d\\u00e9cisions"\n);\n'
                   'expect(t).toContain("relit le fichier de décisions avant chaque \\"ticket\\"");\n')
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "echappements")
        self.edit("avant chaque ticket", "au début de chaque ticket")
        self.assertEqual(list(check.pinned_tests(self.plugin)), ["tests/consigne.test.ts"])

    def test_sans_ligne_retiree_rien_n_est_choisi(self):
        self.edit("const court", "const ajout = 1;\nconst court")
        self.assertEqual(check.pinned_tests(self.plugin), {})

    def test_chaque_fichier_de_test_se_lit_une_seule_fois(self):
        lines = "".join(f'const c{n} = "Une consigne numéro {n} assez longue pour compter dans le diff";\n' for n in range(300))
        self.write("hooks/long.ts", lines)
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "long")
        (self.plugin / "hooks" / "long.ts").write_text(lines.replace("assez longue", "plutôt longue"), encoding="utf-8")
        reads = []
        original = Path.read_text

        def counted(path, *args, **kwargs):
            reads.append(path.name)
            return original(path, *args, **kwargs)

        with mock.patch.object(Path, "read_text", counted):
            check.pinned_tests(self.plugin)
        self.assertEqual(sorted(reads), ["autre.test.tsx", "consigne.test.ts", "court.test.ts"])

    def test_un_echec_de_git_diff_fait_echouer(self):
        with mock.patch.object(check, "git", lambda args, timeout=30: None):
            with self.assertRaises(check.Failed):
                check.pinned_tests(self.plugin)

    def test_quick_check_ajoute_le_test_epingle_et_l_annonce_a_part(self):
        self.edit("avant chaque ticket", "au début de chaque ticket")
        calls, out = self.quick()
        self.assertEqual(calls, [["tests/consigne.test.ts"]])
        self.assertIn("→ tests qui épinglent un texte retiré : consigne.test.ts (« ", out)
        line = next(l for l in out.splitlines() if "épinglent un texte retiré" in l)
        fragment = line.split("(« ", 1)[1].split(" »)", 1)[0]
        self.assertLessEqual(len(fragment), 60)

    def test_quick_check_ne_double_pas_un_test_deja_touche(self):
        self.edit("avant chaque ticket", "au début de chaque ticket")
        self.write("tests/consigne.test.ts", f'expect(texte).toContain("{PHRASE}");\n// touché\n')
        calls, out = self.quick()
        self.assertEqual(calls, [["tests/consigne.test.ts"]])
        self.assertNotIn("épinglent un texte retiré", out)

    def test_quick_check_sans_ligne_retiree_garde_sa_sortie(self):
        calls, out = self.quick()
        self.assertEqual(calls, [])
        self.assertIn("→ aucun fichier de test du moteur touché face à HEAD", out)
        self.assertNotIn("épinglent", out)


if __name__ == "__main__":
    unittest.main()
