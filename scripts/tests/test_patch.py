"""Tests de scripts/patch.py : python3 -m unittest discover -s scripts/tests."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "patch.py"


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, encoding="utf-8")


class PatchTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        self.file = self.root / "doc.md"
        self.file.write_bytes("un\r\ndeux « git »\r\ntrois\r\n".encode("utf-8"))

    def tearDown(self):
        self.dir.cleanup()

    def test_remplace_un_texte_unique_et_garde_les_fins_de_ligne(self):
        out = run(str(self.file), "deux « git »", "deux « git » et demi")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("ligne 2", out.stdout)
        self.assertEqual(self.file.read_bytes().decode("utf-8"), "un\r\ndeux « git » et demi\r\ntrois\r\n")

    def test_textes_lus_dans_des_fichiers(self):
        (self.root / "ancien").write_bytes("un\r\ndeux".encode("utf-8"))
        (self.root / "nouveau").write_bytes("1\r\n2".encode("utf-8"))
        out = run(str(self.file), f"@{self.root / 'ancien'}", f"@{self.root / 'nouveau'}")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertTrue(self.file.read_bytes().decode("utf-8").startswith("1\r\n2 « git »"))

    def test_arobase_doublee_est_litterale(self):
        out = run(str(self.file), "trois", "@@trois")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("@trois", self.file.read_text(encoding="utf-8"))

    def test_rien_n_est_ecrit_sans_occurrence_unique(self):
        before = self.file.read_bytes()
        for old in ["absent", "\r\n", ""]:
            out = run(str(self.file), old, "x")
            self.assertEqual(out.returncode, 1)
            self.assertIn("ÉCHEC", out.stderr)
            self.assertEqual(self.file.read_bytes(), before)
        self.assertIn("paraît 3 fois", run(str(self.file), "\r\n", "x").stderr)

    def test_fichier_absent_et_mauvais_nombre_d_arguments(self):
        self.assertEqual(run(str(self.root / "absent.md"), "a", "b").returncode, 1)
        self.assertEqual(run(str(self.file), "@" + str(self.root / "absent"), "b").returncode, 1)
        self.assertEqual(run(str(self.file), "a").returncode, 2)


if __name__ == "__main__":
    unittest.main()
