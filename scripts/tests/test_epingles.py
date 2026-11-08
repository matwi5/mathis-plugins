"""Tests de scripts/epingles.py : python3 -m unittest discover -s scripts/tests."""

import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT = ROOT / "scripts" / "epingles.py"
PROCEDURE = ROOT / "plugins" / "flow-board" / "reference" / "procedure-groupe.md"


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, encoding="utf-8", cwd=ROOT)


def line_of(path, start):
    """La ligne entière d'un fichier qui commence par ce texte (une phrase de consigne réelle)."""
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith(start):
            return line
    raise AssertionError(f"aucune ligne ne commence par « {start} » dans {path}")


class EpinglesTest(unittest.TestCase):
    def test_trouve_le_test_qui_epingle_un_fragment_de_la_phrase_donnee_entiere(self):
        # La phrase du garde-fou de la procédure, donnée entière : son test n'en épingle que des morceaux,
        # écrits avec des apostrophes échappées (\') dans une chaîne JavaScript.
        phrase = line_of(PROCEDURE, "- Le garde-fou d'un worktree refuse les commandes")
        out = run(phrase)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("plugins/flow-board/tests/procedure-groupe.test.mjs", out.stdout)
        self.assertIn("« Le garde-fou d'un worktree refuse les commandes qu'il ne sait pas lire", out.stdout)

    def test_chaque_trouvaille_donne_le_numero_de_ligne_et_le_fragment(self):
        phrase = line_of(PROCEDURE, "- Le garde-fou d'un worktree refuse les commandes")
        out = run(phrase, "flow-board")
        rows = [r for r in out.stdout.splitlines() if r.startswith("  ")]
        self.assertTrue(rows, out.stdout)
        for row in rows:
            number, _, fragment = row.strip().partition(" : ")
            self.assertTrue(number.isdigit(), row)
            self.assertTrue(fragment.startswith("« ") and fragment.endswith(" »"), row)
            self.assertGreaterEqual(len(fragment) - 4, 30, row)

    def test_une_phrase_epinglee_nulle_part_donne_aucun_test_et_sort_en_0(self):
        # Assemblée ici, pour que ce fichier ne la porte pas lui-même en un seul morceau de 30 signes.
        phrase = " ".join(reversed(["rares.", "mots", "de", "zébrée", "test,", "un", "dans", "écrite", "jamais", "n'a", "personne"]))
        out = run(phrase)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("aucun test", out.stdout)

    def test_le_plugin_borne_la_recherche_a_ses_tests(self):
        phrase = line_of(PROCEDURE, "- Le garde-fou d'un worktree refuse les commandes")
        out = run(phrase, "stats-board")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertNotIn("flow-board/tests", out.stdout)

    def test_un_plugin_inconnu_ou_sans_phrase_sort_en_erreur(self):
        self.assertEqual(run("une phrase", "plugin-qui-n-existe-pas").returncode, 2)
        self.assertEqual(run().returncode, 2)


if __name__ == "__main__":
    unittest.main()
