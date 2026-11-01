"""Tests de l'extrait d'une commande en échec (scripts/check.py, `failure_excerpt`) :
python3 -m unittest discover -s scripts/tests."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402


def bun_output(filler=80):
    """Une sortie de `claude plugin test` : un test en échec, son attendu et son reçu après la ligne
    `(fail)`, des lignes de journal du mod, puis assez de tests passés pour que la fin ne montre pas l'échec."""
    lines = ["", "tests/essai.test.ts:", "(pass) premier [1ms]"]
    lines += ["[flow-board] relais lu", "(fail) le compte se relit [5ms]",
              "  AssertionError: expect(received).toEqual(expected)",
              "  [flow-board] écriture du relais",
              "  ",
              "  Expected: 2",
              "  Received: {",
              "    done: 1,",
              "  }",
              "",
              "  at <anonymous> (tests/essai.test.ts:12:5)"]
    lines += [f"(pass) suivant {n} [1ms]" for n in range(filler)]
    lines += ["[flow-board] fin", " 80 pass", " 1 fail", "Ran 81 tests across 1 file. [3s]"]
    return "\n".join(lines)


class ExcerptTest(unittest.TestCase):
    def test_l_extrait_montre_l_attendu_et_le_recu_apres_la_ligne_d_echec(self):
        excerpt = check.failure_excerpt(bun_output())
        self.assertIn("(fail) le compte se relit", excerpt)
        self.assertIn("  Expected: 2", excerpt)
        self.assertIn("  Received: {", excerpt)
        # La suite du reçu (sur plusieurs lignes) vient avec lui, jusqu'à la ligne vide.
        self.assertIn("    done: 1,", excerpt)
        self.assertNotIn("tests/essai.test.ts:12:5", excerpt)

    def test_l_extrait_retire_les_lignes_de_journal_du_mod(self):
        excerpt = check.failure_excerpt(bun_output())
        self.assertNotIn("[flow-board]", excerpt)
        self.assertIn(" 1 fail", excerpt)

    def test_le_recu_s_arrete_au_test_suivant_sans_ligne_vide(self):
        # La vraie sortie de `claude plugin test` enchaîne parfois le reçu et le `(pass)` suivant.
        lines = ["(fail) un texte [2ms]", "  AssertionError: expect(received).toBe(expected)", "  Expected: \"a\"",
                 "  Received: \"b\""] + [f"(pass) voisin {n} [1ms]" for n in range(80)]
        excerpt = check.failure_excerpt("\n".join(lines)).splitlines()
        self.assertIn("  Received: \"b\"", excerpt)
        self.assertNotIn("(pass) voisin 0 [1ms]", excerpt)

    def test_seuls_les_premiers_echecs_montrent_leur_recu(self):
        lines = []
        for n in range(check.RECEIVED_FIRST + 1):
            lines += [f"(fail) t{n} [1ms]", "  a", "  b", "  c", f"  Received: r{n}"]
        lines += [f"(pass) {n}" for n in range(80)]
        excerpt = check.failure_excerpt("\n".join(lines)).splitlines()
        self.assertIn(f"  Received: r{check.RECEIVED_FIRST - 1}", excerpt)
        self.assertNotIn(f"  Received: r{check.RECEIVED_FIRST}", excerpt)

    def test_sans_recu_le_contexte_reste_de_deux_lignes(self):
        out = "\n".join(["(fail) court [1ms]", "  a", "  b", "  c", "  d"] + [f"(pass) {n}" for n in range(80)])
        excerpt = check.failure_excerpt(out)
        self.assertIn("  b", excerpt.splitlines())
        self.assertNotIn("  c", excerpt.splitlines())


if __name__ == "__main__":
    unittest.main()
