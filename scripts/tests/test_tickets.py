"""Tests de scripts/tickets.py, la recherche d'un terme dans les tickets ouverts de toutes les missions :
python3 -m unittest discover -s scripts/tests."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "tickets.py"
OUVERT = ("# 03: Le registre garde la carte\n\n**What to build:** `lireRegistre` garde la carte.\n\n"
          "**Status:** en cours\n\n- [ ] `lireRegistre` rend la carte.\n")
FAIT = "# 04: Ancien travail\n\nStatus: fait\n\nTouchait `lireRegistre`.\n"
RETIRE = "# 05: Retiré\n\n**Statut :** retiré\n\n`lireRegistre` aussi.\n"
ILLISIBLE = "# 01: Sans statut lisible\n\n**Status:** peut-être\n\nNomme lireRegistre.\n"
SANS_STATUT = "# 02: Sans ligne de statut\n\nNomme LIREREGISTRE en capitales.\n"
AUTRE = "# 07: Rien à voir\n\n**Status:** à faire\n\nAutre chose.\n"


def clean_env():
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True,
                          env=clean_env()).stdout.strip()


class TicketsSearchTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name) / "depot"
        files = [("travail/alpha/issues/03-registre.md", OUVERT), ("travail/alpha/issues/04-ancien.md", FAIT),
                 ("travail/alpha/issues/05-retire.md", RETIRE), ("travail/beta/issues/01-illisible.md", ILLISIBLE),
                 ("travail/beta/issues/02-sans-statut.md", SANS_STATUT), ("travail/beta/issues/07-autre.md", AUTRE),
                 ("travail/beta/spec.md", "lireRegistre dans la spec\n"),
                 ("travail/beta/DECISIONS.md", "lireRegistre dans les décisions\n")]
        for rel, text in files:
            (self.repo / rel).parent.mkdir(parents=True, exist_ok=True)
            (self.repo / rel).write_text(text, encoding="utf-8")
        git(self.repo, "init", "-q", "-b", "main")
        git(self.repo, "config", "user.name", "essai")
        git(self.repo, "config", "user.email", "essai@localhost")
        git(self.repo, "config", "commit.gpgsign", "false")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "base")

    def tearDown(self):
        self.dir.cleanup()

    def run_script(self, *args, cwd=None):
        return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True,
                              encoding="utf-8", cwd=cwd or self.repo, env=clean_env())

    def test_liste_les_tickets_ouverts_groupes_par_mission_avec_titre_statut_et_lignes(self):
        out = self.run_script("lireRegistre")
        self.assertEqual(out.returncode, 0, out.stderr)
        text = out.stdout
        self.assertIn("travail/alpha (1 ticket)", text)
        self.assertIn("  03 · Le registre garde la carte · statut : en cours", text)
        self.assertIn("    3 : **What to build:** `lireRegistre` garde la carte.", text)
        self.assertIn("    7 : - [ ] `lireRegistre` rend la carte.", text)
        # Ni le ticket fait, ni le retiré ; ni la spec, ni les décisions.
        self.assertNotIn("Ancien travail", text)
        self.assertNotIn("Retiré", text)
        self.assertNotIn("dans la spec", text)
        self.assertNotIn("dans les décisions", text)
        self.assertNotIn("Rien à voir", text)
        self.assertLess(text.index("travail/alpha"), text.index("travail/beta"))
        self.assertIn("total : 3 tickets dans 2 missions", text)

    def test_un_statut_illisible_ou_absent_est_liste_et_le_dit(self):
        text = self.run_script("lireregistre").stdout
        self.assertIn("travail/beta (2 tickets)", text)
        self.assertIn("  01 · Sans statut lisible · statut illisible (peut-être)", text)
        self.assertIn("  02 · Sans ligne de statut · statut illisible (aucune ligne de statut)", text)
        self.assertIn("    3 : Nomme LIREREGISTRE en capitales.", text)

    def test_tous_liste_aussi_les_tickets_faits_et_retires(self):
        text = self.run_script("--tous", "lireRegistre").stdout
        self.assertIn("  04 · Ancien travail · statut : fait", text)
        self.assertIn("  05 · Retiré · statut : retiré", text)
        self.assertIn("travail/alpha (3 tickets)", text)
        self.assertIn("total : 5 tickets dans 2 missions", text)

    def test_plusieurs_termes_un_ticket_une_fois(self):
        text = self.run_script("lireRegistre", "garde la carte").stdout
        self.assertEqual(text.count("  03 · Le registre garde la carte"), 1)
        self.assertIn("    1 : # 03: Le registre garde la carte", text)
        self.assertIn("« lireRegistre », « garde la carte » : 3 tickets ouverts\n", text)
        self.assertIn("« garde la carte » : 1 ticket ouvert\n", self.run_script("garde la carte").stdout)

    def test_aucun_ticket_sort_en_zero_et_le_dit(self):
        out = self.run_script("introuvable")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("aucun ticket ouvert ne nomme « introuvable »", out.stdout)

    def test_sans_terme_l_aide_et_le_code_2(self):
        for args in ([], ["--tous"], ["  "]):
            out = self.run_script(*args)
            self.assertEqual(out.returncode, 2, out.stdout)
            self.assertIn("python3 scripts/tickets.py", out.stderr)

    def test_hors_d_un_depot_code_1(self):
        outside = Path(self.dir.name) / "dehors"
        outside.mkdir()
        out = self.run_script("lireRegistre", cwd=outside)
        self.assertEqual(out.returncode, 1, out.stdout)
        self.assertIn("pas dans un dépôt git", out.stderr)

    def test_une_ligne_longue_est_coupee_autour_du_terme_et_entiere_avec_entier(self):
        long_line = "a" * 400 + " le terme rare " + "b" * 400
        path = self.repo / "travail" / "alpha" / "issues" / "03-registre.md"
        path.write_text(OUVERT + long_line + "\n", encoding="utf-8")
        out = self.run_script("terme rare")
        self.assertIn("le terme rare", out.stdout)
        self.assertIn("… (coupée)", out.stdout)
        self.assertNotIn("a" * 300, out.stdout)
        whole = self.run_script("--entier", "terme rare")
        self.assertIn(long_line, whole.stdout)
        self.assertNotIn("(coupée)", whole.stdout)

    def test_depuis_un_worktree_lie_lit_les_tickets_du_clone_principal(self):
        linked = Path(self.dir.name) / "lie"
        git(self.repo, "worktree", "add", "-q", "-b", "lie", str(linked))
        # Un ticket écrit dans le clone principal après le départ du worktree, et un autre dans le worktree seul.
        neuf = self.repo / "travail" / "gamma" / "issues" / "01-neuf.md"
        neuf.parent.mkdir(parents=True)
        neuf.write_text("# 01: Neuf\n\n**Status:** à faire\n\nNomme symboleNeuf.\n", encoding="utf-8")
        seul = linked / "travail" / "gamma" / "issues" / "02-seul.md"
        seul.parent.mkdir(parents=True)
        seul.write_text("# 02: Seul\n\n**Status:** à faire\n\nNomme symboleSeul.\n", encoding="utf-8")
        out = self.run_script("symboleNeuf", cwd=linked)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("  01 · Neuf · statut : à faire", out.stdout)
        self.assertIn(str(self.repo.resolve()), out.stdout)
        self.assertIn("aucun ticket ouvert ne nomme", self.run_script("symboleSeul", cwd=linked).stdout)

    def test_lecture_seule_rien_n_est_ecrit(self):
        before = git(self.repo, "status", "--porcelain", "--ignored")
        self.run_script("lireRegistre", "; rm -rf x", "$(touch y)", "../..")
        self.assertEqual(git(self.repo, "status", "--porcelain", "--ignored"), before)
        self.assertFalse((self.repo / "y").exists())


if __name__ == "__main__":
    unittest.main()
