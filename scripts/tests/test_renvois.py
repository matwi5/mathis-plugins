"""Tests de scripts/renvois.py (les renvois `chemin:ligne` d'une spec ou d'un ticket) :
python3 -m unittest discover -s scripts/tests."""

import contextlib
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import renvois  # noqa: E402
import test_check_snapshot  # noqa: E402  (le lecteur du corpus hostile commun)

CODE = "\n".join(["# en-tête", "", "def premier():", "    pass", "", "", "", "", "", "", "def second():", "    pass"]) + "\n"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class Depot(unittest.TestCase):
    """Un dépôt d'essai : `src/code.py` (12 lignes, `premier` ligne 3, `second` ligne 11) suivi, un fichier
    non suivi, un fichier hors du dépôt ; un ticket écrit hors du dépôt. Sans test à lui."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        base = Path(self.dir.name).resolve()
        self.repo = base / "depot"
        self.repo.mkdir()
        self.outside = base / "dehors.py"
        self.outside.write_text("def premier():\n    pass\n", encoding="utf-8")
        git(self.repo, "init", "-q", "-b", "main")
        (self.repo / "src").mkdir()
        (self.repo / "src/code.py").write_text(CODE, encoding="utf-8")
        git(self.repo, "add", "src/code.py")
        (self.repo / "src/libre.py").write_text(CODE, encoding="utf-8")
        self.ticket = base / "ticket.md"

    def tearDown(self):
        self.dir.cleanup()

    def run_on(self, text):
        self.ticket.write_text(text, encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = renvois.main([str(self.ticket)], root=self.repo)
        return code, out.getvalue()

    def assert_refused(self, ref, reason):
        """Le renvoi est refusé pour cette raison, sans échec, et aucun fichier cité n'est ouvert."""
        with mock.patch.object(renvois, "read_cited", wraps=renvois.read_cited) as read:
            code, out = self.run_on(f"La fonction `premier` (`{ref}`).\n")
        self.assertEqual(code, 0, out)
        self.assertIn(f"refusé, non lu ({reason})", out)
        self.assertIn("1 refusé(s) non lu(s)", out)
        self.assertEqual(read.call_args_list, [], "un chemin refusé n'est jamais ouvert")


class RenvoisTest(Depot):
    def test_un_nom_a_trois_lignes_au_plus_est_juste(self):
        for line in (3, 1, 6):
            with self.subTest(line=line):
                code, out = self.run_on(f"La fonction `premier` (`src/code.py:{line}`) lit le ticket.\n")
                self.assertEqual(code, 0, out)
                self.assertIn("0 renvoi(s) faux, 0 refusé(s) non lu(s), sur 1 relu(s)", out)

    def test_un_bloc_de_code_n_est_pas_relu(self):
        # Une sortie de grep citée dans un bloc garde ses anciens numéros : ni faux renvoi, ni fin de paragraphe ratée.
        text = ("Recherche :\n```\nsrc/code.py:40:    second()\n~~~\nsrc/code.py:3:second\n```\n"
                "~~~\nsrc/code.py:13\n~~~\nLa fonction `premier` (`src/code.py:3`).\n")
        code, out = self.run_on(text)
        self.assertEqual(code, 0, out)
        self.assertIn("0 renvoi(s) faux, 0 refusé(s) non lu(s), sur 1 relu(s)", out)

    def test_une_plage_compte_entiere(self):
        code, out = self.run_on("Les deux, `second` : `src/code.py:3-9`.\n")
        self.assertEqual(code, 0, out)

    def test_un_nom_present_ailleurs_est_decale(self):
        code, out = self.run_on("La fonction `second` (`src/code.py:3`) lit le ticket.\n")
        self.assertEqual(code, 1)
        self.assertIn("ticket.md:1 : `src/code.py:3` : décalé : second est ligne 11", out)

    def test_un_nom_absent_est_absent(self):
        code, out = self.run_on("La fonction `troisieme` (`src/code.py:3`) lit le ticket.\n")
        self.assertEqual(code, 1)
        self.assertIn("absent : troisieme n'est pas dans src/code.py", out)

    def test_une_ligne_au_dela_de_la_fin_est_hors_fichier(self):
        for ref in ("src/code.py:13", "src/code.py:10-40"):
            with self.subTest(ref=ref):
                code, out = self.run_on(f"Voir `{ref}`.\n")
                self.assertEqual(code, 1)
                self.assertIn("hors fichier (src/code.py a 12 lignes)", out)

    def test_sans_nom_juste_si_la_ligne_existe(self):
        code, out = self.run_on("Voir `src/code.py:12`, et `relay.ts` ailleurs.\n")
        self.assertEqual(code, 0, out)

    def test_le_nom_le_plus_proche_dans_la_meme_phrase(self):
        # `second` est dans la phrase d'avant : seul `premier`, de la phrase du renvoi, compte.
        code, out = self.run_on("On appelle `second`. Puis `premier` (`src/code.py:3`).\n")
        self.assertEqual(code, 0, out)
        code, out = self.run_on("Ici `premier`, puis `second` : `src/code.py:3`.\n")
        self.assertIn("décalé : second est ligne 11", out)

    def test_un_nom_apres_le_renvoi_se_mesure_depuis_sa_fin(self):
        # `second` est à 17 signes avant le renvoi, `premier` à 11 après lui : `premier` est le plus proche.
        code, out = self.run_on("Le nom `second` puis le renvoi `src/code.py:3` qui cite `premier`.\n")
        self.assertEqual(code, 0, out)

    def test_un_nom_qualifie_se_cherche_par_son_dernier_membre(self):
        code, out = self.run_on("Le membre `Code.premier` (`src/code.py:3`).\n")
        self.assertEqual(code, 0, out)
        code, out = self.run_on("Le membre `Code.second` (`src/code.py:3`).\n")
        self.assertIn("décalé : second est ligne 11", out)

    def test_un_chemin_sans_extension_est_un_renvoi(self):
        (self.repo / "src/sans-extension").write_text(CODE, encoding="utf-8")
        git(self.repo, "add", "src/sans-extension")
        code, out = self.run_on("La fonction `second` (`src/sans-extension:3`). Ici ligne:3 n'en est pas un.\n")
        self.assertEqual(code, 1)
        self.assertIn("`src/sans-extension:3` : décalé : second est ligne 11", out)
        self.assertIn("sur 1 relu(s)", out)

    def test_une_plage_inversee_hors_du_fichier_est_hors_fichier(self):
        code, out = self.run_on("Plage inversée `src/code.py:40-3`.\n")
        self.assertEqual(code, 1)
        self.assertIn("hors fichier (src/code.py a 12 lignes)", out)

    def test_a_egalite_le_nom_d_avant(self):
        # `premier` et `second` à deux signes du renvoi, de part et d'autre : celui d'avant compte.
        code, out = self.run_on("`premier` `src/code.py:3` `second`\n")
        self.assertEqual(code, 0, out)
        code, out = self.run_on("`second` `src/code.py:3` `premier`\n")
        self.assertIn("décalé : second est ligne 11", out)

    def test_la_phrase_se_coupe_apres_un_point_virgule_mais_pas_apres_une_abreviation(self):
        code, out = self.run_on("On lit `second` ; puis `src/code.py:3`.\n")
        self.assertEqual(code, 0, out)
        for text in ("La fonction `premier` (cf. `src/code.py:11`).\n", "La fonction `premier`, p. ex. `src/code.py:11`.\n"):
            with self.subTest(text=text):
                code, out = self.run_on(text)
                self.assertIn("décalé : premier est ligne 3", out)
        # Une lettre seule en fin de phrase (« le groupe G. ») clôt la phrase.
        code, out = self.run_on("La fonction `premier` vit dans le groupe G. Le renvoi suivant vaut `src/code.py:11`.\n")
        self.assertEqual(code, 0, out)

    def test_tableau_puces_et_titre_ne_forment_pas_une_phrase(self):
        for text in ("| La fonction d'entrée | `src/code.py:3` |\n| `second` est défini | `src/code.py:11` |\n",
                     "- La première fonction : `src/code.py:3`\n- `second` vient après\n",
                     "## `premier`\nLe renvoi `src/code.py:11` du bas.\n",
                     "1. La première : `src/code.py:3`\n2. `second` ensuite\n"):
            with self.subTest(text=text):
                code, out = self.run_on(text)
                self.assertEqual(code, 0, out)

    def test_un_membre_qui_ressemble_a_une_extension_reste_un_nom(self):
        code, out = self.run_on("La valeur `self.cfg` (`src/code.py:3`).\n")
        self.assertEqual(code, 1)
        self.assertIn("absent : cfg n'est pas dans src/code.py", out)

    def test_un_chemin_windows_absolu_est_refuse(self):
        code, out = self.run_on("Voir C:/Users/x/a.py:3 et C:\\x\\a.py:3.\n")
        self.assertEqual(code, 0, out)
        self.assertIn("2 refusé(s) non lu(s), sur 2 relu(s)", out)
        self.assertIn("refusé, non lu (chemin absolu)", out)

    def test_une_phrase_sur_deux_lignes_garde_son_nom_et_le_renvoi_sa_ligne(self):
        code, out = self.run_on("Titre.\n\nLa fonction `premier`\n(`src/code.py:11`).\n")
        self.assertEqual(code, 1)
        self.assertIn("ticket.md:4 : `src/code.py:11` : décalé : premier est ligne 3", out)
        # Une ligne vide clôt le paragraphe : le nom d'avant ne passe pas.
        code, out = self.run_on("La fonction `premier`\n\n(`src/code.py:11`).\n")
        self.assertEqual(code, 0, out)

    def test_le_chemin_entre_accents_graves_et_la_ligne_dehors(self):
        code, out = self.run_on("`src/code.py`:11 pour `premier`.\n")
        self.assertEqual(code, 1)
        self.assertIn("décalé : premier est ligne 3", out)

    def test_l_hote_d_une_adresse_n_est_pas_un_renvoi(self):
        code, out = self.run_on("Voir https://example.com:8080 et `premier` `src/code.py:3`.\n")
        self.assertEqual(code, 0, out)
        self.assertIn("0 refusé(s) non lu(s), sur 1 relu(s)", out)

    def test_un_fichier_illisible_n_empeche_pas_les_autres(self):
        self.ticket.write_text("La fonction `second` (`src/code.py:3`).\n", encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = renvois.main([str(self.ticket), str(self.repo / "absent.md")], root=self.repo)
        self.assertEqual(code, 2)
        self.assertIn("décalé : second est ligne 11", out.getvalue())
        self.assertIn("absent.md illisible", out.getvalue())

    def test_corpus_hostile_commun_jamais_ouvert(self):
        # Le garde des chemins cités (classe « chemin ») : aucun chemin qui porte une entrée du corpus n'est
        # ouvert, sosie de `src/code.py` compris.
        entries = test_check_snapshot.SnapshotTicketFormTest.corpus()
        self.assertGreater(len(entries), 60)
        known = renvois.tracked(self.repo)
        opened = [name for name, token in entries.items()
                  for path in (f"src/code{token}.py", f"src/{token}/code.py", f"{token}src/code.py")
                  if renvois.admitted(path, self.repo, known)[0] is not None]
        self.assertEqual(opened, [])
        self.assertIsNotNone(renvois.admitted("src/code.py", self.repo, known)[0])

    def test_chemins_refuses_non_lus(self):
        cases = {
            f"{self.repo}/src/code.py:3": "chemin absolu",
            "../dehors.py:1": "segment « .. »",
            "src/../src/code.py:3": "segment « .. »",
            "src/libre.py:3": "non suivi par git",
            "~/x.py:1": "chemin absolu",
        }
        for ref, reason in cases.items():
            with self.subTest(ref=ref):
                self.assert_refused(ref, reason)

    def test_un_chemin_refuse_n_est_passe_a_aucune_commande(self):
        calls = []
        real = subprocess.run

        def spy(args, **kw):
            calls.append(list(args))
            return real(args, **kw)

        with mock.patch.object(renvois.subprocess, "run", spy):
            self.run_on("`premier` (`../dehors.py:1`), `src/code.py:3`, `; rm -rf x.py:1`.\n")
        self.assertEqual(calls, [["git", "ls-files", "-z"]])

    def test_n_ecrit_rien(self):
        before = sorted((p, p.stat().st_mtime_ns) for p in self.repo.rglob("*") if ".git" not in p.parts)
        self.run_on("`second` (`src/code.py:3`).\n")
        after = sorted((p, p.stat().st_mtime_ns) for p in self.repo.rglob("*") if ".git" not in p.parts)
        self.assertEqual(before, after)

    def test_un_fichier_nomme_se_lit_tel_quel_suivi_ou_non(self):
        # Le ticket est hors du dépôt : il se lit quand même.
        code, out = self.run_on("`premier` : `src/code.py:3`.\n")
        self.assertEqual(code, 0, out)
        self.assertIn("sur 1 relu(s)", out)


@unittest.skipIf(os.name == "nt", "liens symboliques : mode développeur requis sous Windows")
class LienSymboliqueTest(Depot):
    """Un lien symbolique suivi par git qui vise hors du dépôt, ou un fichier non suivi du dépôt."""

    def test_un_lien_vers_l_exterieur_du_depot_est_refuse(self):
        os.symlink(self.outside, self.repo / "src/lien.py")
        git(self.repo, "add", "src/lien.py")
        self.assert_refused("src/lien.py:1", "hors du dépôt")

    def test_un_lien_vers_un_fichier_non_suivi_du_depot_est_refuse(self):
        os.symlink(self.repo / ".git/config", self.repo / "src/config.py")
        git(self.repo, "add", "src/config.py")
        self.assert_refused("src/config.py:1", "vise un fichier non suivi")


if __name__ == "__main__":
    unittest.main()
