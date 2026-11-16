"""Tests de scripts/decisions.py, la recherche dans tous les fichiers de décisions :
python3 -m unittest discover -s scripts/tests."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "decisions.py"
A = ("# Décisions — a\n\n## Décisions en vigueur\n\n- Série 1 — les cartes.\n\n"
     "## Série 1 — Où vivent les cartes (01/11/2026)\n\n**Q3** : les cartes vivent dans le registre (R80).\n"
     "Autre ligne sans rien.\n\n## Série 2 — Suite (02/11/2026)\n\n- **C7** — Les CARTES perdues se relèvent.\n")
B = "# Décisions — b\n\n## Série 1 — Rien (01/11/2026)\n\nUne carte seule.\n"
PERSONAL = "# Décisions datées\n\n| 12/10 | cartes au COO |\n"


def clean_env():
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True,
                          env=clean_env()).stdout.strip()


class DecisionsSearchTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.dir.name) / "depot"
        for rel, text in [("travail/a/DECISIONS.md", A), ("travail/b/DECISIONS.md", B),
                          ("config/personal/DECISIONS.md", PERSONAL), ("travail/c/autre.md", "cartes\n")]:
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

    def test_rend_toutes_les_lignes_groupees_par_fichier_avec_serie_ids_et_comptes(self):
        out = self.run_script("cartes")
        self.assertEqual(out.returncode, 0, out.stderr)
        text = out.stdout
        self.assertIn("« cartes » : 5 lignes dans 2 fichiers", text)
        self.assertIn("config/personal/DECISIONS.md (1)", text)
        self.assertIn("travail/a/DECISIONS.md (4)", text)
        self.assertIn("  5 · avant la première série : - Série 1 — les cartes.", text)
        self.assertIn("  7 · Série 1 — Où vivent les cartes (01/11/2026) : ## Série 1", text)
        self.assertIn("  9 · Série 1 — Où vivent les cartes (01/11/2026) · Q3, R80 : **Q3** : les cartes", text)
        self.assertIn("  14 · Série 2 — Suite (02/11/2026) · C7 : - **C7** — Les CARTES perdues", text)
        self.assertIn("total « cartes » : 5", text)
        self.assertNotIn("travail/b/", text)
        self.assertNotIn("autre.md", text)
        # Le fichier personnel vient avant ceux des chantiers.
        self.assertLess(text.index("config/personal"), text.index("travail/a"))

    def test_plusieurs_termes_ont_chacun_leurs_resultats(self):
        out = self.run_script("carte seule", "registre")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("« carte seule » : 1 ligne dans 1 fichier", out.stdout)
        self.assertIn("travail/b/DECISIONS.md (1)", out.stdout)
        self.assertIn("« registre » : 1 ligne dans 1 fichier", out.stdout)

    def test_aucun_resultat_sort_en_zero_et_le_dit(self):
        out = self.run_script("introuvable")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("aucune décision ne porte « introuvable »", out.stdout)

    def test_une_ligne_longue_est_coupee_autour_du_terme_et_entiere_avec_entier(self):
        long_line = "a" * 400 + " le terme rare " + "b" * 400
        path = self.repo / "travail" / "b" / "DECISIONS.md"
        path.write_text(B + long_line + "\n", encoding="utf-8")
        out = self.run_script("terme rare")
        self.assertIn("le terme rare", out.stdout)
        self.assertIn("… (coupée)", out.stdout)
        self.assertNotIn("a" * 300, out.stdout)
        whole = self.run_script("--entier", "terme rare")
        self.assertIn(long_line, whole.stdout)
        self.assertNotIn("(coupée)", whole.stdout)

    def test_depuis_un_worktree_lie_lit_les_fichiers_du_clone_principal(self):
        linked = Path(self.dir.name) / "lie"
        git(self.repo, "worktree", "add", "-q", "-b", "lie", str(linked))
        # Une série écrite dans le clone principal après le départ du worktree.
        path = self.repo / "travail" / "b" / "DECISIONS.md"
        path.write_text(B + "\n## Série 2 — Neuve (03/11/2026)\n\nUne décision neuve.\n", encoding="utf-8")
        (linked / "travail" / "b" / "DECISIONS.md").write_text(B + "Seulement dans le worktree.\n", encoding="utf-8")
        out = self.run_script("neuve", cwd=linked)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("Série 2 — Neuve (03/11/2026) : Une décision neuve.", out.stdout)
        self.assertIn(str(self.repo.resolve()), out.stdout)
        self.assertIn("aucune décision ne porte", self.run_script("worktree", cwd=linked).stdout)

    @unittest.skipUnless(os.name == "posix" and os.geteuid() != 0, "droits POSIX, hors root")
    def test_un_fichier_illisible_est_dit_et_les_autres_sont_lus(self):
        path = self.repo / "travail" / "b" / "DECISIONS.md"
        path.chmod(0)
        try:
            out = self.run_script("cartes")
        finally:
            path.chmod(0o644)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("travail/b/DECISIONS.md", out.stdout)
        self.assertIn("fichier illisible", out.stdout)
        self.assertIn("travail/a/DECISIONS.md (4)", out.stdout)

    def test_lecture_seule_rien_n_est_ecrit(self):
        before = git(self.repo, "status", "--porcelain")
        self.run_script("cartes", "; rm -rf x", "$(touch y)")
        self.assertEqual(git(self.repo, "status", "--porcelain"), before)
        self.assertFalse((self.repo / "y").exists())

    def test_un_git_trop_ancien_ou_absent_est_dit_tel_quel(self):
        import importlib.util
        import io
        from contextlib import redirect_stderr
        from unittest import mock
        sys.path.insert(0, str(SCRIPT.parent))
        try:
            spec = importlib.util.spec_from_file_location("decisions_essai", SCRIPT)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        finally:
            sys.path.remove(str(SCRIPT.parent))
        import decision
        for fake, message in [(lambda *a, **k: "git version 2.30.1", "plus ancien que 2.36"),
                              (mock.Mock(side_effect=FileNotFoundError("git")), "git absent")]:
            err = io.StringIO()
            with mock.patch.object(decision, "out", fake), redirect_stderr(err):
                self.assertEqual(module.main(["cartes"]), 1)
            self.assertIn(message, err.getvalue())
            self.assertNotIn("pas dans un dépôt", err.getvalue())

    def test_sans_terme_la_commande_est_refusee(self):
        self.assertEqual(self.run_script().returncode, 2)
        self.assertEqual(self.run_script("--entier").returncode, 2)
