"""Tests du refus d'une valeur relue du parcours insérée brute dans un texte (scripts/check.py,
`raw_interpolations`) : python3 -m unittest discover -s scripts/tests."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402


class InterpolationsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        root = Path(self.dir.name)
        self.plugin = root / "flow-board"
        (self.plugin / "hooks").mkdir(parents=True)
        (self.plugin / "tests").mkdir()
        self.admitted = root / "admises.json"
        patcher = mock.patch.object(check, "ADMITTED_INTERPOLATIONS", self.admitted)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.dir.cleanup()

    def write(self, rel, text):
        (self.plugin / rel).write_text(text, encoding="utf-8")

    def admit(self, files):
        self.admitted.write_text(json.dumps({"files": files}), encoding="utf-8")

    def test_une_interpolation_brute_est_refusee_avec_le_fichier_et_la_ligne(self):
        self.write("hooks/model.ts", "const a = 1\nconst t = `Parcours « ${run.title} » (${g.id}) : ${change.why}, ${role.run.id}`\n")
        problems = check.raw_interpolations(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("flow-board/hooks/model.ts", problems[0])
        self.assertIn("4 ", problems[0])
        self.assertIn("0 admis", problems[0])
        self.assertIn("2 « run.title »", problems[0])

    def test_les_fonctions_de_neutralisation_et_les_autres_valeurs_passent(self):
        self.write("hooks/view.tsx", "const t = `« ${neutralInPrompt(run.title)} » ${shownGroupId(g.id)} ${asciiJson(run.id)} ${g.name} ${run.phase}`\n"
                   "// ${run.title} dans un commentaire\n")
        self.write("tests/a.test.ts", "const t = `${run.title}`\n")
        self.write("hooks/notes.md", "`${run.title}`\n")
        self.assertEqual(check.raw_interpolations(self.plugin), [])

    def test_une_expression_composee_ou_une_assertion_non_nulle_compte_aussi(self):
        self.write("hooks/model.ts", "const a = `${phase.linked.closing!.why}`\n"
                   "const b = `${omitted.map(g => g.id).join(', ')} ${String(run.title)} ${state.why.replace(/ /g, NB)} ${x?.why ?? '-'}`\n")
        problems = check.raw_interpolations(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn(" 5 ", problems[0])
        self.assertIn("1 « phase.linked.closing!.why »", problems[0])

    def test_une_condition_n_insere_rien(self):
        self.write("hooks/model.ts", "const t = `${t.why ? 'a' : 'b'} ${g.id === 'A' ? 'x' : 'y'} ${!run.title ? 'z' : ''} ${inFlightWhy(g)}`\n")
        self.assertEqual(check.raw_interpolations(self.plugin), [])

    def test_la_liste_admet_un_nombre_par_fichier_et_un_de_plus_echoue(self):
        self.write("hooks/model.ts", "const t = `${run.title} ${g.id}`\n")
        self.admit({"flow-board/hooks/model.ts": 2})
        self.assertEqual(check.raw_interpolations(self.plugin), [])
        self.admit({"flow-board/hooks/model.ts": 1})
        self.assertEqual(len(check.raw_interpolations(self.plugin)), 1)

    def test_un_autre_plugin_n_est_pas_controle(self):
        other = Path(self.dir.name) / "git-board"
        (other / "hooks").mkdir(parents=True)
        (other / "hooks" / "a.ts").write_text("const t = `${run.title}`\n", encoding="utf-8")
        self.assertEqual(check.raw_interpolations(other), [])

    def test_la_liste_du_depot_couvre_le_code_actuel_de_flow_board(self):
        real = Path(check.__file__).resolve().parent / "interpolations-admises.json"
        with mock.patch.object(check, "ADMITTED_INTERPOLATIONS", real):
            self.assertEqual(check.raw_interpolations(check.PLUGINS / "flow-board"), [])


if __name__ == "__main__":
    unittest.main()
