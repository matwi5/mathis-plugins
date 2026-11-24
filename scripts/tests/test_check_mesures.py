"""Tests des mesures qu'une étape verte de scripts/check.py imprime (`MEASURES`, `step`) : la longueur du brief
d'un worker que `tests/brief-sessions-liees.test.ts` de flow-board écrit sur sa sortie d'erreur.
python3 -m unittest discover -s scripts/tests."""

import io
import re
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402

OUT = """(pass) le brief : la procédure par son chemin [376.32ms]

 12 pass
 0 fail
brief procédure : 10786 signes, marge 1214
brief groupes Sonnet et Opus : 12100 signes, marge -100
un autre brief : 3 signes
"""


class MeasuresTest(unittest.TestCase):
    def step(self, out, code=0):
        printed = io.StringIO()
        with mock.patch.object(check, "run", lambda args, timeout: (code, out)), redirect_stdout(printed):
            check.step("claude plugin test x", ["claude"], 60, r"\d+ pass")
        return printed.getvalue()

    def test_une_etape_verte_imprime_chaque_mesure_de_brief_sous_son_ok(self):
        printed = self.step(OUT)
        self.assertIn("  ok (12 pass)\n  brief procédure : 10786 signes, marge 1214\n"
                      "  brief groupes Sonnet et Opus : 12100 signes, marge -100\n", printed)
        self.assertNotIn("un autre brief", printed)

    def test_la_ligne_qu_ecrit_le_test_des_briefs_est_celle_que_check_lit(self):
        # Le gabarit du test TypeScript, rempli : s'il change de forme, cette ligne ne serait plus imprimée.
        source = (check.PLUGINS / "flow-board/tests/brief-sessions-liees.test.ts").read_text(encoding="utf-8")
        found = re.search(r"stderr\?\.error\(`(brief [^`]*)`\)", source)
        self.assertIsNotNone(found, "la ligne de mesure du test des briefs")
        line = found.group(1).replace("${label}", "groupes Sonnet et Opus").replace("${length}", "12100")
        line = line.replace("${CAP - length}", "-100")
        self.assertNotIn("${", line)
        self.assertRegex(line, check.MEASURES)
        self.assertEqual(check.MEASURES.findall(f"x\n{line}\ny\n"), [line])

    def test_sans_mesure_rien_de_plus(self):
        self.assertEqual(self.step("(pass) x\n 1 pass\n"), "→ claude plugin test x\n  ok (1 pass)\n")


if __name__ == "__main__":
    unittest.main()
