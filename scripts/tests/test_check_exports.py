"""Tests du refus d'une valeur exportée par un module de `hooks/` qu'aucun autre fichier du plugin ne
nomme (scripts/check.py, `dead_exports`) : python3 -m unittest discover -s scripts/tests."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import check  # noqa: E402


class DeadExportsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        root = Path(self.dir.name)
        self.plugin = root / "essai-board"
        (self.plugin / "hooks").mkdir(parents=True)
        (self.plugin / "tests").mkdir()
        self.admitted = root / "exports-admis.json"
        patcher = mock.patch.object(check, "ADMITTED_EXPORTS", self.admitted)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.dir.cleanup()

    def write(self, rel, text):
        path = self.plugin / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def admit(self, files):
        self.admitted.write_text(json.dumps({"files": files}), encoding="utf-8")

    def test_un_export_que_personne_ne_nomme_est_refuse_avec_le_fichier_la_ligne_et_le_nom(self):
        self.write("hooks/model.ts", "const a = 1\nexport function oublie() { return a }\n")
        problems = check.dead_exports(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("essai-board/hooks/model.ts", problems[0])
        self.assertIn("2 « oublie »", problems[0])

    def test_un_export_nomme_par_un_autre_module_ou_un_test_passe(self):
        self.write("hooks/model.ts", "export const lu = 1\nexport class Vu {}\nexport async function teste() {}\n")
        self.write("hooks/view.tsx", "import { lu, Vu } from './model'\n")
        self.write("tests/model.test.ts", "import { teste } from '../hooks/model'\n")
        self.assertEqual(check.dead_exports(self.plugin), [])

    def test_un_export_lu_seulement_dans_un_mts_du_plugin_passe(self):
        self.write("hooks/model.ts", "export function lue() {}\n")
        self.write("scripts/outil.mts", "import { lue } from '../hooks/model.ts'\n")
        self.assertEqual(check.dead_exports(self.plugin), [])

    def test_un_nom_qui_ne_parait_que_dans_son_propre_module_ou_dans_un_mot_plus_long_reste_mort(self):
        self.write("hooks/model.ts", "export const seul = 1\nconst b = seul + 1\n")
        self.write("hooks/view.tsx", "const seulement = 2\n")
        problems = check.dead_exports(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("1 « seul »", problems[0])

    def test_les_types_et_l_entree_du_mod_ne_comptent_pas(self):
        self.write("hooks/register.tsx", "export type T = number\nexport interface I {}\nexport const register = () => {}\n")
        self.assertEqual(check.dead_exports(self.plugin), [])

    def test_l_entree_register_ne_compte_que_dans_register_tsx(self):
        self.write("hooks/model.ts", "export function register() {}\n")
        self.assertEqual(len(check.dead_exports(self.plugin)), 1)

    def test_les_exports_morts_admis_passent_et_un_de_plus_est_refuse_avec_chaque_ligne(self):
        self.write("hooks/model.ts", "export let a = 1\nexport enum E { X }\n")
        self.admit({"essai-board/hooks/model.ts": 2})
        self.assertEqual(check.dead_exports(self.plugin), [])
        self.write("hooks/model.ts", "export let a = 1\nexport enum E { X }\nexport const nouveau = 2\n")
        problems = check.dead_exports(self.plugin)
        self.assertEqual(len(problems), 1)
        self.assertIn("3 valeur(s)", problems[0])
        self.assertIn("2 admis", problems[0])
        for site in ("1 « a »", "2 « E »", "3 « nouveau »"):
            self.assertIn(site, problems[0])

    def test_une_liste_d_admis_donnee_en_argument_remplace_celle_du_depot(self):
        self.write("hooks/model.ts", "export const mort = 1\n")
        other = Path(self.dir.name) / "copie.json"
        other.write_text(json.dumps({"files": {"essai-board/hooks/model.ts": 1}}), encoding="utf-8")
        self.assertEqual(check.dead_exports(self.plugin, other), [])
        self.assertEqual(len(check.dead_exports(self.plugin)), 1)


if __name__ == "__main__":
    unittest.main()
