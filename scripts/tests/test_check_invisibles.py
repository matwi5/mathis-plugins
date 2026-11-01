"""Tests du refus des caractères invisibles bruts dans les sources des plugins (scripts/check.py) :
python3 -m unittest discover -s scripts/tests.

Les caractères s'écrivent ici par `chr` : l'outil Write change un échappement à quatre chiffres
en caractère brut, le défaut même que ce contrôle refuse."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

BACKSLASH = chr(92)


class InvisiblesTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.plugin = Path(self.dir.name) / "essai"
        (self.plugin / "hooks").mkdir(parents=True)
        (self.plugin / "tests").mkdir()

    def tearDown(self):
        self.dir.cleanup()

    def write(self, rel, text):
        path = self.plugin / rel
        path.write_bytes(text.encode("utf-8"))
        return path

    def test_un_separateur_brut_est_refuse_avec_fichier_ligne_et_echappement(self):
        self.write("hooks/model.ts", "const a = 1\nconst s = 'x" + chr(0x2028) + "y'\n")
        problems = check.invisible_chars(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("essai/hooks/model.ts:2", problems[0])
        self.assertIn("U+2028", problems[0])
        self.assertIn(BACKSLASH + "u2028", problems[0])

    def test_chaque_famille_est_vue_dans_ts_tsx_et_mjs_tests_compris(self):
        codes = [0x85, 0x2029, 0x200B, 0x200F, 0x202A, 0x202E, 0x2060, 0x2069, 0xFEFF]
        self.write("hooks/a.ts", "".join(f"// {chr(c)}\n" for c in codes))
        self.write("hooks/b.tsx", "const r = /[" + chr(0x200D) + "]/\n")
        self.write("tests/c.test.mjs", "x" + chr(0x2028) + "\n")
        problems = check.invisible_chars(self.plugin)
        self.assertEqual(len(problems), len(codes) + 2)
        self.assertTrue(any("essai/hooks/a.ts:9" in p and "U+FEFF" in p for p in problems))
        self.assertTrue(any("essai/hooks/b.tsx:1" in p and "U+200D" in p for p in problems))
        self.assertTrue(any("essai/tests/c.test.mjs:1" in p for p in problems))

    def test_l_echappement_et_les_autres_fichiers_passent(self):
        self.write("hooks/model.ts", "const s = '" + BACKSLASH + "u2028'\nconst e = 'é « » — '\n")
        self.write("README.md", "texte " + chr(0x200B) + "\n")
        self.write("hooks/notes.json", chr(0xFEFF) + "{}\n")
        self.assertEqual(check.invisible_chars(self.plugin), [])


if __name__ == "__main__":
    unittest.main()
