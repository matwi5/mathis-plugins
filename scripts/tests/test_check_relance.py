"""Tests de la relance d'une commande qui a dépassé son délai (scripts/check.py, `step`) :
python3 -m unittest discover -s scripts/tests."""

import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402


class RelanceTest(unittest.TestCase):
    def lance(self, answers):
        """Lance `step` avec un `run` simulé qui rend tour à tour les réponses données ;
        rend (appels reçus, sortie imprimée, erreur levée ou None)."""
        calls = []
        replies = list(answers)

        def fake_run(args, timeout, *rest, **kw):
            calls.append((list(args), timeout))
            return replies.pop(0)

        saved = check.run
        check.run = fake_run
        out = io.StringIO()
        err = None
        try:
            with redirect_stdout(out):
                try:
                    check.step("tests du moteur", ["claude", "plugin", "test"], 900)
                except check.Failed as e:
                    err = e
        finally:
            check.run = saved
        return calls, out.getvalue(), err

    def test_un_depassement_puis_un_succes_relance_une_fois_et_le_dit(self):
        calls, out, err = self.lance([(124, "pas fini en 900 s"), (0, "12 pass")])
        self.assertIsNone(err)
        self.assertEqual(calls, [(["claude", "plugin", "test"], 900)] * 2)
        self.assertIn("relancé une fois après un dépassement de délai", out)
        self.assertIn("ok", out.splitlines()[-1])

    def test_deux_depassements_echouent_en_nommant_les_deux(self):
        calls, out, err = self.lance([(124, "pas fini en 900 s"), (124, "pas fini en 900 s")])
        self.assertEqual(len(calls), 2)
        self.assertIsNotNone(err)
        self.assertIn("deux dépassements de délai", str(err))
        self.assertIn("relancé une fois après un dépassement de délai", str(err))

    def test_un_echec_ordinaire_n_est_jamais_relance(self):
        calls, out, err = self.lance([(1, "(fail) un test")])
        self.assertEqual(len(calls), 1)
        self.assertIsNotNone(err)
        self.assertIn("échec (code 1)", str(err))
        self.assertNotIn("relancé", out + str(err))

    def test_un_echec_ordinaire_apres_la_relance_n_est_pas_relance_encore(self):
        calls, out, err = self.lance([(124, "pas fini en 900 s"), (1, "(fail) un test")])
        self.assertEqual(len(calls), 2)
        self.assertIn("échec (code 1)", str(err))
        self.assertIn("relancé une fois après un dépassement de délai", str(err))


class RelanceSuitePythonTest(unittest.TestCase):
    """La suite Python (`python_tests`) ne passe pas par `step` : elle se relance de même."""

    def lance(self, outcomes):
        calls = []
        outcomes = list(outcomes)

        class Done:
            def __init__(self, code, out):
                self.returncode, self.stdout, self.stderr = code, out, ""

        def fake_run(*args, **kwargs):
            calls.append(kwargs.get("timeout"))
            outcome = outcomes.pop(0)
            if outcome is None:
                raise check.subprocess.TimeoutExpired(args[0], kwargs.get("timeout"))
            return Done(*outcome)

        saved = check.subprocess.run
        check.subprocess.run = fake_run
        out = io.StringIO()
        err = None
        try:
            with redirect_stdout(out):
                try:
                    check.python_tests(Path("."))
                except check.Failed as e:
                    err = e
        finally:
            check.subprocess.run = saved
        return calls, out.getvalue(), err

    def test_un_depassement_puis_un_succes_relance_la_suite_une_fois(self):
        calls, out, err = self.lance([None, (0, "Ran 3 tests in 0.1s\n\nOK")])
        self.assertIsNone(err)
        self.assertEqual(calls, [check.SCRIPTS_TIMEOUT] * 2)
        self.assertIn("relancé une fois après un dépassement de délai", out)

    def test_deux_depassements_de_la_suite_echouent_en_nommant_les_deux(self):
        calls, out, err = self.lance([None, None])
        self.assertEqual(len(calls), 2)
        self.assertIn("deux dépassements de délai", str(err))

    def test_un_echec_de_la_suite_n_est_pas_relance(self):
        calls, out, err = self.lance([(1, "FAIL: test_x (t.T)\n")])
        self.assertEqual(len(calls), 1)
        self.assertNotIn("relancé", out + str(err))


if __name__ == "__main__":
    unittest.main()
