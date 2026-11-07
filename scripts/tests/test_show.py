"""Tests de scripts/show.py : python3 -m unittest discover -s scripts/tests."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "show.py"


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, encoding="utf-8")


class ShowTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.file = Path(self.dir.name) / "doc.md"
        lines = [f"ligne {n}" for n in range(1, 41)]
        lines[9] = "## Règles (git, $(x) et [crochets])"
        lines[29] = "## Règles (git, $(x) et [crochets]) bis"
        self.file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def test_affiche_la_plage_depuis_le_motif_litteral_avec_les_numeros(self):
        out = run(str(self.file), "Règles (git, $(x) et [crochets])", "+3")
        self.assertEqual(out.returncode, 0, out.stderr)
        rows = out.stdout.splitlines()
        self.assertEqual(rows[:4], ["10\t## Règles (git, $(x) et [crochets])", "11\tligne 11", "12\tligne 12", "13\tligne 13"])
        self.assertIn("aussi ligne 30", out.stdout)

    def test_sans_nombre_la_plage_par_defaut_et_la_fin_du_fichier(self):
        out = run(str(self.file), "ligne 38")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout.splitlines(), ["38\tligne 38", "39\tligne 39", "40\tligne 40"])

    def test_un_motif_absent_sort_en_erreur(self):
        out = run(str(self.file), "absent")
        self.assertEqual(out.returncode, 1)
        self.assertIn("ÉCHEC", out.stderr)
        self.assertEqual(out.stdout, "")

    def test_arguments_et_fichier_invalides(self):
        self.assertEqual(run(str(self.file)).returncode, 2)
        self.assertEqual(run(str(self.file), "ligne", "3").returncode, 2)
        self.assertEqual(run(str(self.file), "ligne", "+0").returncode, 2)
        self.assertEqual(run(str(Path(self.dir.name) / "absent.md"), "ligne").returncode, 1)


class ListeTest(unittest.TestCase):
    """`show.py --liste <fichier> <motif>` : une ligne par occurrence, son numéro et un extrait borné
    autour du motif, même sur une ligne de plusieurs milliers de caractères."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.file = Path(self.dir.name) / "README.md"
        long_line = "a" * 3000 + " Rétro du lien " + "b" * 3000 + " Rétro du lien " + "c" * 50
        self.file.write_text(f"# Titre\nla Rétro du lien\n{long_line}\nfin\n", encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def test_une_ligne_par_occurrence_avec_son_numero_et_un_extrait_borne(self):
        out = run("--liste", str(self.file), "Rétro du lien")
        self.assertEqual(out.returncode, 0, out.stderr)
        rows = out.stdout.splitlines()
        self.assertEqual(rows[0], "2\tla Rétro du lien")
        self.assertEqual(len(rows), 3)
        for row in rows[1:]:
            self.assertTrue(row.startswith("3\t…"), row)
            self.assertIn("Rétro du lien", row)
            self.assertLess(len(row), 260)
        self.assertTrue(rows[1].endswith("…"))
        self.assertTrue(rows[2].endswith("c" * 50))

    def test_un_motif_absent_rend_le_code_1(self):
        out = run("--liste", str(self.file), "absent")
        self.assertEqual(out.returncode, 1)
        self.assertIn("ÉCHEC", out.stderr)
        self.assertEqual(out.stdout, "")

    def test_un_fichier_absent_ou_un_motif_vide_sont_des_erreurs(self):
        self.assertEqual(run("--liste", str(Path(self.dir.name) / "absent.md"), "x").returncode, 1)
        self.assertEqual(run("--liste", str(self.file), "").returncode, 2)
        out = run("--liste", str(self.file))
        self.assertEqual(out.returncode, 2)
        self.assertIn("--liste <fichier> <motif>", out.stderr)
        self.assertIn("<motif> [+N]", run(str(self.file)).stderr)


if __name__ == "__main__":
    unittest.main()
