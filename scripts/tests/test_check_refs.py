"""Tests du refus des renvois aux décisions d'un parcours (scripts/check.py) :
python3 -m unittest discover -s scripts/tests."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402


class DecisionRefsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        root = Path(self.dir.name)
        self.plugin = root / "essai"
        (self.plugin / "hooks").mkdir(parents=True)
        self.code = self.plugin / "hooks" / "model.ts"
        self.admitted = root / "renvois-admis.json"
        self.saved = check.ADMITTED_REFS
        check.ADMITTED_REFS = self.admitted

    def tearDown(self):
        check.ADMITTED_REFS = self.saved
        self.dir.cleanup()

    def refs(self, code, admitted):
        self.code.write_text(code, encoding="utf-8")
        self.admitted.write_text(json.dumps({"date": "2026-10-29", "files": admitted}), encoding="utf-8")
        return check.ticket_refs(self.plugin)

    def test_le_motif_voit_q_s_et_serie_mais_pas_un_mot_ordinaire(self):
        found = [m.group(0) for m in check.DECISION_REFS.finditer("Q3, S15, série 19, Séries 2, Q2.2 ; pas SQL, S3x, q3, AS15, -S1")]
        self.assertEqual(found, ["Q3", "S15", "série 19", "Séries 2", "Q2.2"])

    def test_un_renvoi_de_plus_que_les_admis_echoue(self):
        code = "// la règle (série 18)\nconst x = 1 // Q5\n"
        self.assertEqual(self.refs(code, {"essai/hooks/model.ts": 2}), [])
        problems = self.refs(code + "// S23\n", {"essai/hooks/model.ts": 2})
        self.assertEqual(len(problems), 1)
        self.assertIn("3 renvois aux décisions", problems[0])
        self.assertIn("2 admis", problems[0])
        self.assertIn("3 « S23 »", problems[0])

    def test_seuls_les_commentaires_comptent_dans_le_code(self):
        self.assertEqual(self.refs("const Q5 = 'S23'\n", {}), [])
        self.assertEqual(len(self.refs("const a = 1 // Q5\n", {})), 1)


if __name__ == "__main__":
    unittest.main()
