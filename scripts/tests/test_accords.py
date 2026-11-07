"""Tests de scripts/accords.py (accords restés à l'ancien nom après un renommage) :
python3 -m unittest discover -s scripts/tests."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import accords  # noqa: E402

SCRIPT = Path(__file__).resolve().parent.parent / "accords.py"


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, encoding="utf-8")


class AccordsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)

    def tearDown(self):
        self.dir.cleanup()

    def write(self, name, text):
        path = self.root / name
        path.write_text(text, encoding="utf-8")
        return path

    def test_pronom_participe_et_reprise_sur_la_ligne_suivante(self):
        path = self.write("a.md", "Le groupe est lancée. Elle attend\nque celle-ci finisse.\n")
        found = accords.mismatches([accords.parse_rename("vague:fs=groupe:ms")], [path], window=12)
        self.assertEqual([(f.line, f.word) for f in found], [(1, "lancée"), (1, "Elle"), (2, "celle-ci")])
        self.assertIn("vague", found[0].message)
        self.assertIn("groupe", found[0].message)

    def test_un_accord_juste_ne_dit_rien(self):
        path = self.write("a.md", "Le groupe est lancé. Il attend que celui-ci finisse.\n")
        self.assertEqual(accords.mismatches([accords.parse_rename("vague:fs=groupe:ms")], [path], window=12), [])

    def test_hors_de_la_fenetre_rien_n_est_releve(self):
        path = self.write("a.md", "Le groupe part. " + "mot " * 20 + "Elle reste.\n")
        rename = accords.parse_rename("vague:fs=groupe:ms")
        self.assertEqual(accords.mismatches([rename], [path], window=12), [])
        self.assertEqual(len(accords.mismatches([rename], [path], window=30)), 1)

    def test_le_pluriel_du_nouveau_mot_cherche_l_ancien_pluriel(self):
        path = self.write("a.md", "Les groupes partent ; elles reviennent.\n")
        found = accords.mismatches([accords.parse_rename("vague:fs=groupe:ms")], [path], window=12)
        self.assertEqual([f.word for f in found], ["elles"])

    def test_un_determinant_de_l_ancien_genre_devant_le_nouveau_mot(self):
        path = self.write("a.md", "Lancer la nouveau groupe, puis cette groupe.\n")
        found = accords.mismatches([accords.parse_rename("vague:fs=groupe:ms")], [path], window=12)
        self.assertEqual([f.word for f in found], ["la", "cette"])

    def test_un_changement_de_nombre(self):
        path = self.write("a.md", "Le registre est lu ; elles sont gardées.\n")
        found = accords.mismatches([accords.parse_rename("données:fp=registre:ms")], [path], window=12)
        self.assertEqual([f.word for f in found], ["elles", "gardées"])

    def test_la_commande_liste_fichier_et_ligne_et_refuse_une_forme_fausse(self):
        path = self.write("a.md", "Un mot.\nLe groupe ? Elle part.\n")
        out = run("vague:fs=groupe:ms", "--", str(path))
        self.assertEqual(out.returncode, 1, out.stderr)
        self.assertIn(f"{path}:2", out.stdout)
        self.assertIn("« Elle »", out.stdout)
        clean = self.write("b.md", "Le groupe ? Il part.\n")
        self.assertEqual(run("vague:fs=groupe:ms", "--", str(clean)).returncode, 0)
        for bad in (["vague=groupe", "--", str(path)], ["vague:fs=groupe:ms", str(path)], ["vague:xx=groupe:ms", "--", str(path)]):
            refused = run(*bad)
            self.assertEqual(refused.returncode, 2, bad)
            self.assertIn("accords.py", refused.stderr)


if __name__ == "__main__":
    unittest.main()
