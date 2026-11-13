"""Tests de l'extrait d'une commande en échec et de la dernière ligne d'un échec (scripts/check.py,
`failure_excerpt`, `failing_tests`, `report_failure`) :
python3 -m unittest discover -s scripts/tests."""

import io
import sys
import unittest
from contextlib import redirect_stdout
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

    def test_les_six_dernieres_lignes_d_un_echec_nomment_le_test_et_le_journal(self):
        # Ce que lit une session qui a lancé `check.sh … | tail -6`.
        saved = check.run
        check.run = lambda args, timeout, *rest, **kw: (1, bun_output())
        out = io.StringIO()
        try:
            with redirect_stdout(out):
                try:
                    check.step("claude plugin test essai", ["claude"], 60)
                except check.Failed as err:
                    check.report_failure(err)
        finally:
            check.run = saved
        tail = out.getvalue().rstrip("\n").splitlines()[-6:]
        self.assertTrue(tail[-2].startswith("ÉCHEC : claude plugin test essai : échec (code 1)"), tail)
        self.assertIn("tests en échec : (fail) le compte se relit [5ms]", tail[-2])
        self.assertTrue(tail[-1].startswith("sortie entière : "), tail)
        kept = Path(tail[-1].removeprefix("sortie entière : "))
        self.assertIn("Received: {", kept.read_text(encoding="utf-8"))
        kept.unlink()

    def test_la_ligne_d_echec_borne_les_tests_nommes(self):
        many = "\n".join(f"(fail) t{n} [1ms]" for n in range(check.FAILING_NAMED + 3))
        said = check.failing_tests(many + "\n[flow-board] (fail) journal")
        self.assertIn(f"(fail) t{check.FAILING_NAMED - 1}", said)
        self.assertNotIn(f"(fail) t{check.FAILING_NAMED} ", said)
        self.assertTrue(said.endswith("et 3 autre(s)"))
        self.assertNotIn("journal", said)
        self.assertEqual(check.failing_tests("(pass) a\n"), "")
        # L'en-tête du résumé de `node --test` n'est pas un test en échec.
        node = "✖ rouge un (0.42ms)\nℹ fail 1\n\n✖ failing tests:\n\n✖ rouge un (0.42ms)\n"
        self.assertEqual(check.failing_tests(node), " ; tests en échec : ✖ rouge un (0.42ms)")
        # La suite Python passe par la même borne.
        said = check.named_failures([f"test_{n} (m.T)" for n in range(check.FAILING_NAMED + 2)] + ["test_0 (m.T)"])
        self.assertTrue(said.endswith("et 2 autre(s)"), said)

    def test_sans_recu_le_contexte_reste_de_deux_lignes(self):
        out = "\n".join(["(fail) court [1ms]", "  a", "  b", "  c", "  d"] + [f"(pass) {n}" for n in range(80)])
        excerpt = check.failure_excerpt(out)
        self.assertIn("  b", excerpt.splitlines())
        self.assertNotIn("  c", excerpt.splitlines())


if __name__ == "__main__":
    unittest.main()
