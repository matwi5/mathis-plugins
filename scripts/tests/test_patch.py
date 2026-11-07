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

    def test_la_fin_de_ligne_finale_d_un_fichier_de_texte_est_retiree(self):
        (self.root / "ancien").write_bytes("trois\n".encode("utf-8"))
        (self.root / "nouveau").write_bytes("3\n\n".encode("utf-8"))
        out = run(str(self.file), f"@{self.root / 'ancien'}", f"@{self.root / 'nouveau'}")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.file.read_bytes().decode("utf-8"), "un\r\ndeux « git »\r\n3\n\r\n")

    def test_le_marqueur_ecrit_un_echappement_litteral(self):
        out = run(str(self.file), "trois", "s = '{{u}}2028'")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("s = '" + chr(92) + "u2028'", self.file.read_text(encoding="utf-8"))
        self.assertNotIn(chr(0x2028), self.file.read_text(encoding="utf-8"))

    def test_le_marqueur_s_echappe_en_doublant_son_u(self):
        out = run(str(self.file), "trois", "{{uu}} et {{uuu}}")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("{{u}} et {{uu}}", self.file.read_text(encoding="utf-8"))
        self.assertEqual(run(str(self.file), "{{uu}} et", "x").returncode, 0)
        self.assertIn("x {{uu}}", self.file.read_text(encoding="utf-8"))

    def test_un_fichier_de_lot_en_cible_simple_est_refuse_et_renvoie_a_lot(self):
        lot = self.root / "lot.txt"
        text = "::: fichier doc.md\n::: ancien\ntrois\n::: nouveau\n3\n::: fin\n"
        lot.write_text(text, encoding="utf-8")
        out = run(str(lot), "trois", "3")
        self.assertEqual(out.returncode, 1)
        self.assertIn("--lot", out.stderr)
        self.assertEqual(lot.read_text(encoding="utf-8"), text)
        self.assertIn("trois", self.file.read_text(encoding="utf-8"))

    def test_fichier_absent_et_mauvais_nombre_d_arguments(self):
        self.assertEqual(run(str(self.root / "absent.md"), "a", "b").returncode, 1)
        self.assertEqual(run(str(self.file), "@" + str(self.root / "absent"), "b").returncode, 1)
        self.assertEqual(run(str(self.file), "a").returncode, 2)


class BatchTest(unittest.TestCase):
    """Le mode par lot : `patch.py --lot <fichier de paires>`, tout ou rien."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        self.a = self.root / "a.md"
        self.b = self.root / "b.ts"
        self.a.write_text("titre\nun paragraphe\navec « git » dedans\nfin\n", encoding="utf-8")
        self.b.write_text("const x = 1\nconst y = 2\n", encoding="utf-8")
        self.lot = self.root / "lot.txt"

    def tearDown(self):
        self.dir.cleanup()

    def batch(self, text):
        self.lot.write_text(text, encoding="utf-8")
        return run("--lot", str(self.lot))

    def test_applique_chaque_paire_dans_l_ordre_sur_plusieurs_fichiers(self):
        out = self.batch(
            f"::: fichier {self.a}\n"
            "::: ancien\nun paragraphe\navec « git » dedans\n::: nouveau\ndeux lignes\n\"citées\" ici\n::: fin\n"
            "::: ancien\ndeux lignes\n::: nouveau\n2 lignes\n::: fin\n"
            "\n"
            f"::: fichier {self.b}\n"
            "::: ancien\nconst y = 2\n::: nouveau\nconst y = '{{u}}2028'\n::: fin\n")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.a.read_text(encoding="utf-8"), "titre\n2 lignes\n\"citées\" ici\nfin\n")
        self.assertEqual(self.b.read_text(encoding="utf-8"), "const x = 1\nconst y = '" + chr(92) + "u2028'\n")
        self.assertIn("3 remplacements dans 2 fichiers", out.stdout)

    def test_un_ancien_texte_non_unique_n_ecrit_aucun_fichier(self):
        before = (self.a.read_bytes(), self.b.read_bytes())
        out = self.batch(
            f"::: fichier {self.a}\n::: ancien\ntitre\n::: nouveau\nTitre\n::: fin\n"
            f"::: fichier {self.b}\n::: ancien\nconst\n::: nouveau\nlet\n::: fin\n")
        self.assertEqual(out.returncode, 1)
        self.assertIn("paraît 2 fois", out.stderr)
        self.assertIn("paire 2", out.stderr)
        self.assertEqual((self.a.read_bytes(), self.b.read_bytes()), before)

    def test_un_meme_fichier_sous_deux_noms_garde_chaque_remplacement(self):
        out = self.batch(
            f"::: fichier {self.a}\n::: ancien\ntitre\n::: nouveau\nTitre\n::: fin\n"
            f"::: fichier {self.root}/./a.md\n::: ancien\nfin\n::: nouveau\nFin\n::: fin\n")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.a.read_text(encoding="utf-8"), "Titre\nun paragraphe\navec « git » dedans\nFin\n")
        self.assertIn("2 remplacements dans 1 fichier", out.stdout)

    def test_une_ecriture_refusee_est_dite_sans_trace_python(self):
        self.b.chmod(0o444)
        try:
            out = self.batch(
                f"::: fichier {self.a}\n::: ancien\ntitre\n::: nouveau\nTitre\n::: fin\n"
                f"::: fichier {self.b}\n::: ancien\nconst y = 2\n::: nouveau\nconst y = 3\n::: fin\n")
        finally:
            self.b.chmod(0o644)
        self.assertEqual(out.returncode, 1)
        self.assertIn("ÉCHEC", out.stderr)
        self.assertNotIn("Traceback", out.stderr)
        self.assertIn("déjà écrits", out.stderr)

    def test_un_lot_mal_forme_est_refuse(self):
        before = self.a.read_bytes()
        for text in [
            "::: ancien\nx\n::: nouveau\ny\n::: fin\n",  # aucun fichier nommé
            f"::: fichier {self.a}\n::: ancien\ntitre\n::: fin\n",  # pas de nouveau texte
            f"::: fichier {self.a}\n::: ancien\ntitre\n::: nouveau\nTitre\n",  # pas de fin
            f"::: fichier {self.a}\ntexte hors d'une paire\n",
            "",
        ]:
            out = self.batch(text)
            self.assertEqual(out.returncode, 1, text)
            self.assertIn("ÉCHEC", out.stderr)
        self.assertEqual(self.a.read_bytes(), before)


class AppendTest(unittest.TestCase):
    """`patch.py --append <fichier> <texte>` : un texte ajouté à la fin du fichier, comme un heredoc
    `cat >> <fichier> <<EOF` (suivi d'une fin de ligne), sans que le garde-fou d'un worktree le refuse."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        self.file = self.root / "journal.md"

    def tearDown(self):
        self.dir.cleanup()

    def test_ajoute_le_texte_a_la_fin_suivi_d_une_fin_de_ligne(self):
        self.file.write_bytes("# Journal\n\n- un\n".encode("utf-8"))
        out = run("--append", str(self.file), "- deux « git » é")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("ajouté", out.stdout)
        self.assertEqual(self.file.read_bytes().decode("utf-8"), "# Journal\n\n- un\n- deux « git » é\n")

    def test_garde_les_fins_de_ligne_crlf_du_fichier(self):
        self.file.write_bytes("un\r\ndeux\r\n".encode("utf-8"))
        (self.root / "texte").write_bytes("trois\nquatre\n".encode("utf-8"))
        out = run("--append", str(self.file), f"@{self.root / 'texte'}")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.file.read_bytes().decode("utf-8"), "un\r\ndeux\r\ntrois\r\nquatre\r\n")

    def test_un_fichier_sans_fin_de_ligne_finale_en_recoit_une_avant_le_texte(self):
        self.file.write_bytes("un".encode("utf-8"))
        self.assertEqual(run("--append", str(self.file), "deux").returncode, 0)
        self.assertEqual(self.file.read_bytes().decode("utf-8"), "un\ndeux\n")

    def test_le_marqueur_u_et_l_arobase_valent_comme_pour_un_remplacement(self):
        self.file.write_bytes(b"")
        self.assertEqual(run("--append", str(self.file), "const s = '{{" + "u}}2028'").returncode, 0)
        self.assertEqual(run("--append", str(self.file), "@@dresse").returncode, 0)
        self.assertEqual(self.file.read_bytes().decode("utf-8"), "const s = '" + chr(92) + "u2028'\n@dresse\n")

    def test_un_mauvais_nombre_d_arguments_montre_chaque_forme(self):
        out = run("--append", str(self.file))
        self.assertEqual(out.returncode, 2)
        self.assertIn("--append <fichier> <texte>", out.stderr)
        self.assertIn("--lot <fichier de paires>", out.stderr)

    def test_un_fichier_absent_est_une_erreur_sans_creation(self):
        out = run("--append", str(self.file), "texte")
        self.assertEqual(out.returncode, 1)
        self.assertIn("introuvable", out.stderr)
        self.assertFalse(self.file.exists())

    def test_un_fichier_qui_n_est_pas_en_utf8_ou_un_texte_vide_ne_change_rien(self):
        self.file.write_bytes(b"caf\xe9\n")
        self.assertEqual(run("--append", str(self.file), "x").returncode, 1)
        self.assertEqual(self.file.read_bytes(), b"caf\xe9\n")
        self.file.write_bytes(b"un\n")
        self.assertEqual(run("--append", str(self.file), "").returncode, 1)
        self.assertEqual(self.file.read_bytes(), b"un\n")


if __name__ == "__main__":
    unittest.main()
