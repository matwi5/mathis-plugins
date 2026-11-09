"""Tests de scripts/patch.py : python3 -m unittest discover -s scripts/tests."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "patch.py"


def run(*args, cwd=None):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, encoding="utf-8", cwd=cwd)


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
        self.assertIn("présent 3 fois, lignes 1, 2, 3", run(str(self.file), "\r\n", "x").stderr)

    def test_un_ancien_texte_tres_frequent_donne_son_compte_et_ses_dix_premieres_lignes(self):
        self.file.write_text("x\n" * 25, encoding="utf-8")
        out = run(str(self.file), "x", "y")
        self.assertEqual(out.returncode, 1)
        self.assertIn("présent 25 fois, lignes 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, … ;", out.stderr)

    def test_un_ancien_texte_absent_donne_la_ligne_la_plus_proche_de_sa_premiere_ligne(self):
        before = self.file.read_bytes()
        out = run(str(self.file), "deux « gît »\r\ntrois", "x")
        self.assertEqual(out.returncode, 1)
        self.assertIn("absent ; ligne la plus proche : 2 : deux « git »", out.stderr)
        self.assertEqual(self.file.read_bytes(), before)

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
        self.assertIn("paire 2 : ", out.stderr)
        self.assertIn("présent 2 fois, lignes 1, 2", out.stderr)
        self.assertEqual((self.a.read_bytes(), self.b.read_bytes()), before)

    def test_un_ancien_texte_absent_dit_sa_paire_et_la_ligne_la_plus_proche(self):
        before = (self.a.read_bytes(), self.b.read_bytes())
        out = self.batch(
            f"::: fichier {self.a}\n::: ancien\ntitre\n::: nouveau\nTitre\n::: fin\n"
            f"::: fichier {self.b}\n::: ancien\nconst z = 2\n::: nouveau\nlet z = 2\n::: fin\n")
        self.assertEqual(out.returncode, 1)
        self.assertIn("paire 2 : ", out.stderr)
        self.assertIn("absent ; ligne la plus proche : 2 : const y = 2", out.stderr)
        self.assertEqual((self.a.read_bytes(), self.b.read_bytes()), before)

    def test_les_lignes_d_une_paire_suivante_sont_celles_du_texte_laisse_par_les_precedentes(self):
        out = self.batch(
            f"::: fichier {self.a}\n::: ancien\ntitre\n::: nouveau\nfin\n::: fin\n"
            f"::: ancien\nfin\n::: nouveau\nFin\n::: fin\n")
        self.assertEqual(out.returncode, 1)
        self.assertIn("présent 2 fois, lignes 1, 4", out.stderr)
        self.assertIn("paires précédentes", out.stderr)

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

    def test_un_texte_qui_finit_par_une_fin_de_ligne_n_ajoute_pas_de_ligne_vide(self):
        (self.root / "texte").write_bytes(b"abc\n")
        for start in ("un\n", "un\r\n"):
            results = []
            for text in ("abc", "abc\n", "abc\r\n", f"@{self.root / 'texte'}"):
                with self.subTest(start=start, text=text):
                    self.file.write_bytes(start.encode("utf-8"))
                    out = run("--append", str(self.file), text)
                    self.assertEqual(out.returncode, 0, out.stderr)
                    results.append(self.file.read_bytes())
            newline = start[2:]
            self.assertEqual(results, [f"un{newline}abc{newline}".encode("utf-8")] * 4)

    def test_un_texte_qui_finit_par_deux_fins_de_ligne_garde_sa_ligne_vide(self):
        self.file.write_bytes(b"un\n")
        self.assertEqual(run("--append", str(self.file), "abc\n\n").returncode, 0)
        self.assertEqual(self.file.read_bytes(), b"un\nabc\n\n")

    def test_un_texte_fait_d_une_seule_fin_de_ligne_ajoute_deux_fins_de_ligne_comme_avant(self):
        self.file.write_bytes(b"un\n")
        self.assertEqual(run("--append", str(self.file), "\n").returncode, 0)
        self.assertEqual(self.file.read_bytes(), b"un\n\n\n")

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


class RangeTest(unittest.TestCase):
    """`patch.py --plage <fichier> <première> <dernière> <nouveau> --debut <texte> --fin <texte>` : une
    plage de lignes remplacée, vérifiée par les textes de sa première et de sa dernière ligne."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        self.file = self.root / "doc.md"
        self.file.write_bytes("un\r\ndeux « git »\r\ntrois\r\nquatre\r\ncinq\r\n".encode("utf-8"))

    def tearDown(self):
        self.dir.cleanup()

    def test_remplace_la_plage_verifiee_aux_fins_de_ligne_du_fichier(self):
        out = run("--plage", str(self.file), "2", "4", "2\n3 et 4", "--debut", "deux « git »", "--fin", "quatre")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("lignes 2 à 4", out.stdout)
        self.assertEqual(self.file.read_bytes().decode("utf-8"), "un\r\n2\r\n3 et 4\r\ncinq\r\n")

    def test_le_nouveau_texte_suit_les_conventions_du_script(self):
        (self.root / "nouveau").write_text("A\nB\n", encoding="utf-8")
        out = run("--plage", str(self.file), "5", "5", f"@{self.root / 'nouveau'}", "--debut", "cinq", "--fin", "cinq")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertTrue(self.file.read_bytes().decode("utf-8").endswith("quatre\r\nA\r\nB\r\n"))
        self.assertEqual(run("--plage", str(self.file), "1", "1", "s = '{{" + "u}}2028'", "--debut", "un", "--fin", "un").returncode, 0)
        self.assertTrue(self.file.read_text(encoding="utf-8").startswith("s = '" + chr(92) + "u2028'"))

    def test_une_plage_qui_a_bouge_est_refusee_et_dit_ou_sont_les_textes(self):
        before = self.file.read_bytes()
        out = run("--plage", str(self.file), "1", "3", "x", "--debut", "deux", "--fin", "quatre")
        self.assertEqual(out.returncode, 1)
        self.assertIn("ligne 1 ne porte pas « deux »", out.stderr)
        self.assertIn("« deux » : ligne 2", out.stderr)
        self.assertIn("ligne 3 ne porte pas « quatre »", out.stderr)
        self.assertIn("« quatre » : ligne 4", out.stderr)
        self.assertEqual(self.file.read_bytes(), before)

    def test_un_texte_absent_ou_une_plage_hors_du_fichier_est_refusee(self):
        before = self.file.read_bytes()
        out = run("--plage", str(self.file), "2", "9", "x", "--debut", "deux", "--fin", "neuf")
        self.assertEqual(out.returncode, 1)
        self.assertIn("5 lignes", out.stderr)
        out = run("--plage", str(self.file), "2", "2", "x", "--debut", "absent", "--fin", "deux")
        self.assertEqual(out.returncode, 1)
        self.assertIn("« absent » : sur aucune ligne", out.stderr)
        self.assertEqual(run("--plage", str(self.file), "3", "2", "x", "--debut", "trois", "--fin", "deux").returncode, 1)
        self.assertEqual(self.file.read_bytes(), before)

    def test_sans_debut_ni_fin_la_commande_est_refusee(self):
        out = run("--plage", str(self.file), "2", "2", "x")
        self.assertEqual(out.returncode, 2)
        self.assertIn("--debut <texte> --fin <texte>", out.stderr)


class MoveTest(unittest.TestCase):
    """`patch.py --deplace [--essai] <source> <début> <fin> <cible> <ancre>` : un bloc de lignes déplacé
    d'un fichier à un autre, l'identité des octets prouvée, tout ou rien."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        self.source = self.root / "CLAUDE.md"
        self.target = self.root / "regle.md"
        self.source.write_text("# Titre\n\n## Pièges\n\n- piège un « git »\n  suite\n- piège deux\n\n## Fin\n", encoding="utf-8")
        self.target.write_text("# Règle\n\nIntro.\n\n## Autre\n", encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def move(self, *args):
        return run("--deplace", *args)

    def test_deplace_le_bloc_apres_l_ancre_et_prouve_l_identite(self):
        out = self.move(str(self.source), "piège un", "piège deux", str(self.target), "Intro.")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.source.read_text(encoding="utf-8"), "# Titre\n\n## Pièges\n\n\n## Fin\n")
        self.assertEqual(self.target.read_text(encoding="utf-8"),
                         "# Règle\n\nIntro.\n- piège un « git »\n  suite\n- piège deux\n\n## Autre\n")
        self.assertIn("3 lignes", out.stdout)
        self.assertIn("identiques", out.stdout)
        self.assertIn("sha256", out.stdout)

    def test_essai_n_ecrit_rien(self):
        before = (self.source.read_bytes(), self.target.read_bytes())
        out = self.move("--essai", str(self.source), "piège un", "piège deux", str(self.target), "Intro.")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("lignes 5 à 7", out.stdout)
        self.assertIn("après la ligne 3", out.stdout)
        self.assertIn("rien n'est écrit", out.stdout)
        self.assertEqual((self.source.read_bytes(), self.target.read_bytes()), before)

    def test_une_ancre_double_un_texte_absent_ou_une_fin_avant_le_debut_n_ecrivent_rien(self):
        before = (self.source.read_bytes(), self.target.read_bytes())
        cases = [
            (("piège un", "piège deux", "#"), "« # » : présent sur 2 lignes (1, 5)"),
            (("piège", "piège deux", "Intro."), "« piège » : présent sur 2 lignes (5, 7)"),
            (("piège un", "absent", "Intro."), "« absent » : sur aucune ligne"),
            (("piège deux", "piège un", "Intro."), "la fin (ligne 5) précède le début (ligne 7)"),
        ]
        for (start, end, anchor), message in cases:
            out = self.move(str(self.source), start, end, str(self.target), anchor)
            self.assertEqual(out.returncode, 1, (start, end, anchor))
            self.assertIn(message, out.stderr)
            self.assertEqual((self.source.read_bytes(), self.target.read_bytes()), before)

    def test_garde_les_fins_de_ligne_de_chaque_fichier(self):
        self.source.write_bytes("a\r\nb\r\nc\r\n".encode("utf-8"))
        self.target.write_bytes("x\ny".encode("utf-8"))
        out = self.move(str(self.source), "b", "b", str(self.target), "y")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.source.read_bytes(), b"a\r\nc\r\n")
        self.assertEqual(self.target.read_bytes(), b"x\ny\nb\n")

    def test_un_texte_absent_donne_la_ligne_la_plus_proche(self):
        out = self.move(str(self.source), "piège un", "piège deus", str(self.target), "Intro.")
        self.assertEqual(out.returncode, 1)
        self.assertIn("« piège deus » : sur aucune ligne ; ligne la plus proche : 7 : - piège deux", out.stderr)
        out = run("--plage", str(self.target), "1", "1", "x", "--debut", "Règel", "--fin", "Règle")
        self.assertIn("ligne la plus proche : 1 : # Règle", out.stderr)

    def test_un_bloc_aux_fins_de_ligne_melees_dit_la_conversion_exacte(self):
        self.source.write_bytes(b"a\r\nb\nc\r\nd\n")
        self.target.write_bytes(b"x\n")
        out = self.move(str(self.source), "b", "c", str(self.target), "x")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("fins de ligne CRLF → LF", out.stdout)
        self.assertEqual(self.target.read_bytes(), b"x\nb\nc\n")

    def test_un_bloc_en_fin_de_fichier_sans_fin_de_ligne(self):
        self.source.write_bytes(b"a\nb\nc")
        self.target.write_bytes(b"x\ny\n")
        out = self.move(str(self.source), "b", "c", str(self.target), "x")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.source.read_bytes(), b"a\n")
        self.assertEqual(self.target.read_bytes(), b"x\nb\nc\ny\n")

    def test_une_source_en_lecture_seule_remet_la_cible_et_le_dit(self):
        before = (self.source.read_bytes(), self.target.read_bytes())
        self.source.chmod(0o444)
        try:
            out = self.move(str(self.source), "piège un", "piège deux", str(self.target), "Intro.")
        finally:
            self.source.chmod(0o644)
        self.assertEqual(out.returncode, 1)
        self.assertNotIn("Traceback", out.stderr)
        self.assertIn("remis tels qu'avant et relus", out.stderr)
        self.assertEqual((self.source.read_bytes(), self.target.read_bytes()), before)

    def test_une_source_qui_est_aussi_la_cible_est_refusee(self):
        before = self.source.read_bytes()
        out = self.move(str(self.source), "piège un", "piège deux", f"{self.root}/./CLAUDE.md", "# Titre")
        self.assertEqual(out.returncode, 1)
        self.assertIn("même fichier", out.stderr)
        self.assertEqual(self.source.read_bytes(), before)

    def test_un_mauvais_nombre_d_arguments_montre_la_forme(self):
        out = self.move(str(self.source), "a")
        self.assertEqual(out.returncode, 2)
        self.assertIn("--deplace [--essai] <source> <début> <fin> <cible> <ancre>", out.stderr)


class RefusalTest(unittest.TestCase):
    """Chaque mode qui écrit refuse un chemin de `.git/` et une cible qui est un lien symbolique (ou, pour
    un chemin relatif, dont un dossier sous le dossier courant est un lien), sans rien écrire."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        self.real = self.root / "vrai.md"
        self.real.write_bytes(b"un\ndeux\n")
        self.other = self.root / "autre.md"
        self.other.write_bytes(b"autre\n")

    def tearDown(self):
        self.dir.cleanup()

    def modes(self, path):
        """Les appels de chaque mode qui écrit, sur `path` (un remplacement de « un » par « UN »)."""
        lot = self.root / "paires.txt"
        lot.write_text(f"::: fichier {path}\n::: ancien\nun\n::: nouveau\nUN\n::: fin\n", encoding="utf-8")
        return {
            "simple": [str(path), "un", "UN"],
            "lot": ["--lot", str(lot)],
            "append": ["--append", str(path), "trois"],
            "plage": ["--plage", str(path), "1", "1", "UN", "--debut", "un", "--fin", "un"],
            "deplace-source": ["--deplace", str(path), "un", "un", str(self.other), "autre"],
            "deplace-cible": ["--deplace", str(self.other), "autre", "autre", str(path), "un"],
        }

    def assertRefusedEverywhere(self, path, reason, cwd=None, watched=()):
        for mode, args in self.modes(path).items():
            with self.subTest(mode=mode):
                before = {p: p.read_bytes() for p in (self.real, self.other, *watched)}
                out = run(*args, cwd=cwd)
                self.assertEqual(out.returncode, 1, out.stdout + out.stderr)
                self.assertIn(reason, out.stderr)
                self.assertIn(str(path), out.stderr)
                self.assertEqual({p: p.read_bytes() for p in before}, before)

    @unittest.skipIf(os.name == "nt", "liens symboliques")
    def test_une_cible_qui_est_un_lien_est_refusee_dans_chaque_mode(self):
        link = self.root / "lien.md"
        link.symlink_to(self.real)
        self.assertRefusedEverywhere(link, "lien symbolique")

    @unittest.skipIf(os.name == "nt", "liens symboliques")
    def test_un_dossier_lien_sous_le_dossier_courant_est_refuse_en_relatif(self):
        (self.root / "vrai").mkdir()
        inner = self.root / "vrai" / "x.md"
        inner.write_bytes(b"un\n")
        (self.root / "sous").symlink_to(self.root / "vrai")
        self.assertRefusedEverywhere(Path("sous") / "x.md", "lien symbolique", cwd=self.root, watched=(inner,))

    @unittest.skipIf(os.name == "nt", "liens symboliques")
    def test_un_lien_au_dessus_du_dossier_courant_atteint_par_deux_points_n_est_pas_verifie(self):
        (self.root / "vrai").mkdir()
        (self.root / "ici").mkdir()
        inner = self.root / "vrai" / "x.md"
        inner.write_bytes(b"un\n")
        (self.root / "lien").symlink_to(self.root / "vrai")
        out = run(str(Path("..") / "lien" / "x.md"), "un", "UN", cwd=self.root / "ici")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(inner.read_bytes(), b"UN\n")

    @unittest.skipIf(os.name == "nt", "liens symboliques")
    def test_un_lien_du_dossier_courant_atteint_en_ressortant_par_deux_points_est_refuse(self):
        (self.root / "ici").mkdir()
        (self.root / "vrai").mkdir()
        inner = self.root / "vrai" / "x.md"
        inner.write_bytes(b"un\n")
        (self.root / "ici" / "lien").symlink_to(self.root / "vrai")
        path = Path("..") / "ici" / "lien" / "x.md"
        self.assertRefusedEverywhere(path, "lien symbolique", cwd=self.root / "ici", watched=(inner,))

    def test_une_ecriture_coupee_de_la_cible_d_un_deplacement_est_remise(self):
        sys.path.insert(0, str(SCRIPT.parent))
        try:
            import patch
        finally:
            sys.path.pop(0)
        self.other.write_bytes(b"autre\n")
        real_fdopen, calls = patch.os.fdopen, []

        def cut_once(fd, *args, **kwargs):
            calls.append(fd)
            if len(calls) == 1:  # la première écriture (la cible) est coupée après l'ouverture, qui l'a vidée
                os.close(fd)
                raise OSError(28, "No space left on device")
            return real_fdopen(fd, *args, **kwargs)

        patch.os.fdopen = cut_once
        try:
            with self.assertRaises(patch.PatchError) as raised:
                patch.move(str(self.real), "un", "un", str(self.other), "autre")
        finally:
            patch.os.fdopen = real_fdopen
        self.assertIn("écriture coupée", str(raised.exception))
        self.assertIn("remis tels qu'avant", str(raised.exception))
        self.assertEqual(self.other.read_bytes(), b"autre\n")
        self.assertEqual(self.real.read_bytes(), b"un\ndeux\n")

    def test_une_ecriture_coupee_d_un_remplacement_remet_le_texte_d_avant(self):
        sys.path.insert(0, str(SCRIPT.parent))
        try:
            import patch
        finally:
            sys.path.pop(0)
        real_fdopen, calls = patch.os.fdopen, []

        def cut_once(fd, *args, **kwargs):
            calls.append(fd)
            if len(calls) == 1:
                os.close(fd)
                raise OSError(28, "No space left on device")
            return real_fdopen(fd, *args, **kwargs)

        for call in (lambda: patch.patch(str(self.real), "un", "UN"), lambda: patch.append(str(self.real), "trois")):
            calls.clear()
            patch.os.fdopen = cut_once
            try:
                with self.assertRaises(patch.CutWrite) as raised:
                    call()
            finally:
                patch.os.fdopen = real_fdopen
            self.assertIn("remis tel qu'avant", str(raised.exception))
            self.assertEqual(self.real.read_bytes(), b"un\ndeux\n")

    def test_un_fichier_ordinaire_hors_du_depot_s_ecrit_en_absolu_et_en_relatif(self):
        # Le dossier jetable est sous /var/folders/… sur macOS, où /var est un lien : les dossiers au-dessus
        # du dossier courant, et ceux d'un chemin absolu, ne sont pas vérifiés.
        self.assertEqual(run(str(self.real), "un", "UN").returncode, 0)
        self.assertEqual(run("vrai.md", "deux", "DEUX", cwd=self.root).returncode, 0)
        self.assertEqual(self.real.read_bytes(), b"UN\nDEUX\n")

    def test_un_chemin_de_git_est_refuse_dans_chaque_mode(self):
        for rel in (Path(".git") / "config", Path("sous") / ".git" / "x", Path(".GIT") / "config"):
            with self.subTest(rel=rel):
                path = self.root / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"un\n")
                self.assertRefusedEverywhere(path, "chemin d'un dossier .git", watched=(path,))
                self.assertRefusedEverywhere(rel, "chemin d'un dossier .git", cwd=self.root, watched=(path,))

    @unittest.skipIf(os.name == "nt", "liens symboliques")
    def test_un_chemin_absolu_dont_un_dossier_est_un_lien_vers_git_est_refuse(self):
        (self.root / ".git").mkdir()
        config = self.root / ".git" / "config"
        config.write_bytes(b"un\n")
        (self.root / "dossier").symlink_to(self.root / ".git")
        self.assertRefusedEverywhere(self.root / "dossier" / "config", "chemin d'un dossier .git", watched=(config,))

    @unittest.skipIf(os.name == "nt", "arguments en octets (surrogateescape)")
    def test_un_texte_non_encodable_ne_vide_pas_le_fichier(self):
        # Un octet invalide d'un argument arrive en substitut (surrogateescape), que l'UTF-8 refuse.
        out = subprocess.run([sys.executable, str(SCRIPT), str(self.real), "un", "\udcff"], capture_output=True)
        self.assertEqual(out.returncode, 1, out.stderr)
        self.assertIn("encodable".encode("utf-8"), out.stderr)
        self.assertEqual(self.real.read_bytes(), b"un\ndeux\n")

    @unittest.skipIf(os.name == "nt", "liens symboliques")
    def test_un_lot_dont_une_seule_paire_vise_un_lien_n_ecrit_rien(self):
        link = self.root / "lien.md"
        link.symlink_to(self.other)
        lot = self.root / "paires.txt"
        lot.write_text(f"::: fichier {self.real}\n::: ancien\nun\n::: nouveau\nUN\n::: fin\n"
                       f"::: fichier {link}\n::: ancien\nautre\n::: nouveau\nAUTRE\n::: fin\n", encoding="utf-8")
        out = run("--lot", str(lot))
        self.assertEqual(out.returncode, 1)
        self.assertIn("paire 2", out.stderr)
        self.assertEqual(self.real.read_bytes(), b"un\ndeux\n")
        self.assertEqual(self.other.read_bytes(), b"autre\n")

    @unittest.skipIf(os.name == "nt", "liens symboliques")
    def test_un_lot_qui_nomme_le_meme_fichier_par_un_lien_est_refuse(self):
        link = self.root / "lien.md"
        link.symlink_to(self.real)
        lot = self.root / "paires.txt"
        lot.write_text(f"::: fichier {self.real}\n::: ancien\nun\n::: nouveau\nUN\n::: fin\n"
                       f"::: fichier {link}\n::: ancien\ndeux\n::: nouveau\nDEUX\n::: fin\n", encoding="utf-8")
        out = run("--lot", str(lot))
        self.assertEqual(out.returncode, 1)
        self.assertIn("lien symbolique", out.stderr)
        self.assertEqual(self.real.read_bytes(), b"un\ndeux\n")


if __name__ == "__main__":
    unittest.main()
